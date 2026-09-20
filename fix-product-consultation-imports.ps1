$ErrorActionPreference = "Stop"

$root = (Get-Location).Path

$productConsultationFiles = Get-ChildItem `
  "$root\src\product-consultation" `
  -Recurse `
  -File `
  -Filter *.ts

$extraPaths = @(
  "src\support-agent\graph\support-agent.graph.ts",
  "src\support-agent\graph\support-agent.state.ts",
  "src\support-agent\graph\workers\product-agent.worker.ts",
  "src\support-agent\schemas\support-agent-answer.schema.ts",
  "src\support-agent\debug\run-consultation-feedback.debug.ts",
  "src\support-agent\debug\run-consultation-lifecycle.debug.ts"
)

$extraFiles = $extraPaths |
  ForEach-Object {
    $path = Join-Path $root $_

    if (Test-Path $path) {
      Get-Item $path
    }
  }

$files = @($productConsultationFiles) + @($extraFiles)

$replacements = @(
  @{
    Pattern = "(?<=['""])[^'""]*consultation-core/consultation-core\.schema(?=['""])"
    Value   = "@/src/product-consultation/core/consultation-core.schema"
  },
  @{
    Pattern = "(?<=['""])[^'""]*(?:consultation-core/consultation-core|core/consultation-core)(?=['""])"
    Value   = "@/src/product-consultation/core/consultation-core"
  },
  @{
    Pattern = "(?<=['""])[^'""]*core/profiles(?=['""])"
    Value   = "@/src/product-consultation/core/profiles"
  },

  @{
    Pattern = "(?<=['""])[^'""]*product-context\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/context/product-context.schema"
  },

  @{
    Pattern = "(?<=['""])[^'""]*consultation-session(?=['""])"
    Value   = "@/src/product-consultation/application/session/consultation-session"
  },
  @{
    Pattern = "(?<=['""])[^'""]*consultation-lifecycle\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/session/consultation-lifecycle.schema"
  },

  @{
    Pattern = "(?<=['""])[^'""]*product-need\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/search/product-need.schema"
  },
  @{
    Pattern = "(?<=['""])[^'""]*product-search-results\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/search/product-search-results.schema"
  },

  @{
    Pattern = "(?<=['""])[^'""]*product-agent-result\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/agent/product-agent-result.schema"
  },
  @{
    Pattern = "(?<=['""])[^'""]*agreagte-answer\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/agent/agreagte-answer.schema"
  },
  @{
    Pattern = "(?<=['""])[^'""]*product-agent\.state(?=['""])"
    Value   = "@/src/product-consultation/application/agent/product-agent.state"
  },
  @{
    Pattern = "(?<=['""])[^'""]*product-agent\.service(?=['""])"
    Value   = "@/src/product-consultation/application/agent/product-agent.service"
  },

  @{
    Pattern = "(?<=['""])[^'""]*product-plan(?=['""])"
    Value   = "@/src/product-consultation/application/planner/product-plan"
  },
  @{
    Pattern = "(?<=['""])[^'""]*product-agent\.prompt(?=['""])"
    Value   = "@/src/product-consultation/application/planner/product-agent.prompt"
  },
  @{
    Pattern = "(?<=['""])[^'""]*product-planner-result\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/planner/product-planner-result.schema"
  },

  @{
    Pattern = "(?<=['""])[^'""]*comparison-presentation\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/presentation/comparison-presentation.schema"
  },
  @{
    Pattern = "(?<=['""])[^'""]*product-presentation\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/presentation/product-presentation.schema"
  },

  @{
    Pattern = "(?<=['""])\./comparison-presentation(?=['""])"
    Value   = "@/src/product-consultation/application/presentation/comparison-presentation"
  },
  @{
    Pattern = "(?<=['""])\./product-presentation(?=['""])"
    Value   = "@/src/product-consultation/application/presentation/product-presentation"
  },

  @{
    Pattern = "(?<=['""])[^'""]*product-turn/product-turn(?=['""])"
    Value   = "@/src/product-consultation/application/turns/product-turn"
  },
  @{
    Pattern = "(?<=['""])[^'""]*product-turn/product-turn\.context(?=['""])"
    Value   = "@/src/product-consultation/application/turns/product-turn.context"
  },

  @{
    Pattern = "(?<=['""])[^'""]*subagents/consultation-agent/consultation\.agent(?=['""])"
    Value   = "@/src/product-consultation/application/consultation-agent/consultation.agent"
  },
  @{
    Pattern = "(?<=['""])[^'""]*subagents/consultation-agent/comparison-synthesis(?=['""])"
    Value   = "@/src/product-consultation/application/consultation-agent/comparison-synthesis"
  },
  @{
    Pattern = "(?<=['""])[^'""]*subagents/consultation-agent/schemas/consultation-agent\.schema(?=['""])"
    Value   = "@/src/product-consultation/application/consultation-agent/schemas/consultation-agent.schema"
  },

  @{
    Pattern = "(?<=['""])[^'""]*ai/ai\.service(?=['""])"
    Value   = "@/src/ai/ai.service"
  },

  @{
    Pattern = "(?<=['""])[^'""]*handoff-agent/schemas/handoff\.schema(?=['""])"
    Value   = "@/src/support-agent/agents/handoff-agent/schemas/handoff.schema"
  }
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($file in $files) {
  $content = [System.IO.File]::ReadAllText($file.FullName)

  $updated = $content

  foreach ($replacement in $replacements) {
    $updated = [regex]::Replace(
      $updated,
      $replacement.Pattern,
      $replacement.Value
    )
  }

  if ($updated -ne $content) {
    [System.IO.File]::WriteAllText(
      $file.FullName,
      $updated,
      $utf8NoBom
    )

    Write-Host "Updated: $($file.FullName)"
  }
}

Write-Host ""
Write-Host "Import migration finished."