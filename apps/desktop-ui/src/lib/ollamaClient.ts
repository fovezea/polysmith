interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  response?: string;
}

function trimBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const response = await fetch(`${trimBaseUrl(baseUrl)}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as OllamaTagsResponse;
  return (payload.models ?? [])
    .map((model) => model.name)
    .filter((name): name is string => Boolean(name));
}

export async function requestOllamaChat(
  config: AiConfig,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string> {
  const response = await fetch(`${trimBaseUrl(config.baseUrl)}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model.trim(),
      stream: false,
      format: "json",
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OllamaChatResponse;
  const content = payload.message?.content ?? payload.response;
  if (!content) {
    throw new Error("Ollama response did not include message content.");
  }
  return content;
}
