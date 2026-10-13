"""Offline policy contracts; run inside the pinned image with no network."""
import asyncio
import contextlib
import io
import os
import unittest
from unittest.mock import patch

os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
from fastapi import HTTPException
from gateway_policy import SupportGatewayPolicy


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = SupportGatewayPolicy()
        self.request = {"model": "gpt-6.1-sol", "reasoning": {"effort": "medium"}, "litellm_call_id": "offline", "model_info": {"id": "standard", "transport_profile": "gpt-6.1-sol"}}

    def check(self, request):
        with contextlib.redirect_stdout(io.StringIO()):
            return asyncio.run(self.policy.async_pre_call_deployment_hook(request, "aresponses"))

    def test_unknown_profile_rejected(self):
        self.request["model_info"]["transport_profile"] = "future-model"
        with self.assertRaises(HTTPException): self.check(self.request)

    def test_sol_cannot_use_none_or_sampling(self):
        for override in ({"reasoning": {"effort": "none"}}, {"temperature": 0}, {"use_chat_completions_api": True}, {"model": "gpt-future"}):
            with self.subTest(override=override), self.assertRaises(HTTPException): self.check({**self.request, **override})

    def test_budget_mode_rejects_missing_unverified_or_invalid_prices(self):
        with patch.dict(os.environ, {"SUPPORT_REQUIRE_PRICING": "true"}):
            for prices in ({}, {"input_cost_per_token": 1, "output_cost_per_token": 1}, {"pricing_verified": True, "input_cost_per_token": -1, "output_cost_per_token": 1}, {"pricing_verified": True, "input_cost_per_token": float('nan'), "output_cost_per_token": 1}):
                request = {**self.request, "model_info": {**self.request["model_info"], **prices}}
                with self.subTest(prices=prices), self.assertRaises(HTTPException): self.check(request)

    def test_budget_mode_accepts_explicit_verified_prices(self):
        self.request["model_info"].update({"pricing_verified": True, "input_cost_per_token": 0.001, "output_cost_per_token": 0.002})
        with patch.dict(os.environ, {"SUPPORT_REQUIRE_PRICING": "true"}): self.check(self.request)

    def test_bridge_wrapper_is_not_a_physical_attempt(self):
        request = {"model": "gpt://offline/yandex", "use_chat_completions_api": True, "model_info": {"transport_profile": "yandex-chat"}}
        output = io.StringIO()
        with contextlib.redirect_stdout(output): asyncio.run(self.policy.async_pre_call_deployment_hook(request, "aresponses"))
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
