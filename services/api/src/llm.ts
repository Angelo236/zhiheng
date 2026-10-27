import type { Settings } from "@zhiheng/shared";

export async function completeChat(settings: Settings, apiKey: string, system: string, user: string): Promise<{ content: string; tokens: number }> {
  const response = await fetch(`${settings.modelBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.modelName,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型请求失败（${response.status}）：${detail.slice(0, 280)}`);
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  return {
    content: body.choices?.[0]?.message?.content ?? "",
    tokens: body.usage?.total_tokens ?? 0,
  };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型没有返回 JSON。");
  return JSON.parse(raw.slice(start, end + 1));
}
