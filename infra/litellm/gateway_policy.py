"""Bounded chat gateway policy and deployment telemetry for LiteLLM 1.100.3."""
import json
import math
import os
import time

from fastapi import HTTPException
from litellm import register_model
from litellm.integrations.custom_logger import CustomLogger

# 1.100.3's bundled registry predates these models. Its Responses validator
# looks up the bare name even when the Router registers openai/<name>.
# Declare only verified capabilities; never invent prices or fetch a moving map.
register_model({
    "gpt-6-luna": {"litellm_provider": "openai", "mode": "responses", "supports_none_reasoning_effort": True},
    "gpt-6.1-sol": {"litellm_provider": "openai", "mode": "responses", "supports_none_reasoning_effort": False},
})


class SupportGatewayPolicy(CustomLogger):
    def __init__(self):
        super().__init__()
        self._starts = {}

    @staticmethod
    def _is_bridge_wrapper(request, call_type):
        return (request.get("model_info") or {}).get("transport_profile") == "yandex-chat" and str(call_type) in {"aresponses", "responses", "CallTypes.aresponses", "CallTypes.responses"}

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        if data.get("model") not in {"support-fast", "support-standard"}:
            raise HTTPException(400, "Unapproved support model alias")
        if data.get("stream") or data.get("background") or data.get("previous_response_id"):
            raise HTTPException(400, "Only non-streaming stateless chat is approved")
        headers = (data.get("proxy_server_request") or {}).get("headers") or {}
        if any(key.lower() == "x-litellm-num-retries" for key in headers):
            raise HTTPException(400, "Client retry overrides are not approved")
        for key in (
            "fallbacks", "context_window_fallbacks", "content_policy_fallbacks",
            "num_retries", "max_retries", "max_fallbacks", "retry_policy",
            "api_base", "api_key", "custom_llm_provider", "mock_response",
            "use_chat_completions_api", "use_responses_api", "model_list",
        ):
            if key in data:
                raise HTTPException(400, "Client routing overrides are not approved")
        # Model capabilities belong to the deployment, never to the caller.
        for key in ("reasoning", "reasoning_effort", "temperature", "top_p", "logprobs", "top_logprobs"):
            if key in data:
                raise HTTPException(400, "Sampling and reasoning belong to the gateway deployment")
        for tool in data.get("tools") or []:
            if tool.get("type") != "function":
                raise HTTPException(400, "Only function tools are approved")
        if data.get("store") is True:
            raise HTTPException(400, "Server-stored conversations are not approved")
        return data

    async def async_pre_call_deployment_hook(self, kwargs, call_type):
        info = kwargs.get("model_info") or {}
        profile = info.get("transport_profile")
        model = kwargs.get("model", "")
        bare_model = model.removeprefix("openai/")
        if profile == "yandex-chat":
            valid = bare_model.startswith("gpt://")
            if self._is_bridge_wrapper(kwargs, call_type):
                valid = valid and kwargs.get("use_chat_completions_api") is True
        elif profile in {"gpt-6-luna", "gpt-6.1-sol"}:
            effort = "none" if profile == "gpt-6-luna" else "medium"
            valid = bare_model == profile and kwargs.get("reasoning") == {"effort": effort}
            valid = valid and not kwargs.get("use_chat_completions_api")
            valid = valid and (profile != "gpt-6.1-sol" or "temperature" not in kwargs)
            # Reverse bridging is deliberately not enabled for these deployments.
            valid = valid and str(call_type) in {"aresponses", "responses", "CallTypes.aresponses", "CallTypes.responses"}
        else:
            valid = False
        if not valid:
            raise HTTPException(400, "Unapproved deployment transport profile")
        if os.environ.get("SUPPORT_REQUIRE_PRICING") == "true":
            prices = [info.get("input_cost_per_token"), info.get("output_cost_per_token")]
            if info.get("pricing_verified") is not True or any(not isinstance(price, (float, int)) or isinstance(price, bool) or not math.isfinite(price) or price < 0 for price in prices):
                raise HTTPException(503, "Budget mode requires verified deployment pricing")
        # The bridge invokes these hooks twice: outer Responses conversion and
        # inner Chat Completions. Only the inner provider call is an attempt.
        if not self._is_bridge_wrapper(kwargs, call_type):
            now = time.monotonic()
            self._starts = {key: start for key, start in self._starts.items() if now - start < 120}
            self._starts[(kwargs.get("litellm_call_id"), info.get("id"))] = now
            self._event("started", kwargs, None)
        return kwargs

    def _event(self, status, request, response, error=None, fallback_depth=None):
        info = request.get("model_info") or {}
        hidden = getattr(response, "_hidden_params", {}) or {}
        usage = getattr(response, "usage", None)
        if hasattr(usage, "model_dump"):
            usage = usage.model_dump()
        usage = usage or {}
        profile = info.get("transport_profile")
        started = None if status == "started" else self._starts.pop((request.get("litellm_call_id"), info.get("id")), None)
        print(json.dumps({
            "event": "llm_gateway_deployment",
            "usageScope": "deployment_attempt",
            "status": status,
            "timestamp": time.time(),
            "gatewayRequestId": request.get("litellm_call_id"),
            "deploymentId": info.get("id"),
            "actualProvider": "yandex" if profile == "yandex-chat" else "openai" if profile in {"gpt-6-luna", "gpt-6.1-sol"} else None,
            "actualModel": request.get("model"),
            "inputTokens": usage.get("input_tokens", usage.get("prompt_tokens")),
            "outputTokens": usage.get("output_tokens", usage.get("completion_tokens")),
            "totalTokens": usage.get("total_tokens"),
            "costUsd": hidden.get("response_cost") if info.get("pricing_verified") is True else None,
            "durationMs": (time.monotonic() - started) * 1000 if started is not None else None,
            "fallbackDepth": fallback_depth,
            "errorType": type(error).__name__ if error else None,
        }), flush=True)

    async def async_post_call_success_deployment_hook(self, request_data, response, call_type):
        if self._is_bridge_wrapper(request_data, call_type):
            return response
        choices = getattr(response, "choices", None)
        status = getattr(response, "status", "completed")
        if choices:
            # LiteLLM normalizes unknown reasons to stop. A non-null original
            # value survives in native_finish_reason; inspect it before bridging.
            # Missing/null reasons are lost by Choices.__init__ in this version.
            reasons = [(getattr(choice, "provider_specific_fields", None) or {}).get("native_finish_reason", choice.finish_reason) for choice in choices]
            if any(reason not in {"stop", "tool_calls", "function_call", "length", "content_filter", "refusal"} for reason in reasons):
                raise HTTPException(502, "Unknown upstream completion status")
            if any(reason in {"length", "content_filter", "refusal"} for reason in reasons):
                status = "incomplete"
        self._event("success" if status == "completed" else status, request_data, response)
        return response

    async def async_post_call_failure_deployment_hook(self, request_data, exception, call_type, fallback_depth=None):
        if not self._is_bridge_wrapper(request_data, call_type):
            self._event("error", request_data, None, exception, fallback_depth)

    async def async_post_call_response_headers_hook(self, data, user_api_key_dict, response, request_headers=None, litellm_call_info=None):
        info = (litellm_call_info or {}).get("model_info") or {}
        profile = info.get("transport_profile")
        provider = "yandex" if profile == "yandex-chat" else "openai" if profile in {"gpt-6-luna", "gpt-6.1-sol"} else None
        headers = {"x-support-provider": provider} if provider else {}
        headers["x-support-cost-status"] = "gateway-estimate" if info.get("pricing_verified") is True else "unknown"
        return headers


policy = SupportGatewayPolicy()
