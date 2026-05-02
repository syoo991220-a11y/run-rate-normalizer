import { NextResponse, type NextRequest } from "next/server";
import { TB_FINAL_GAAP_CATEGORIES } from "../../types/studio-finance";

export const runtime = "nodejs";

type ClassifyItem = {
  id: string;
  accountNumber: string;
  accountName: string;
};

type ClassifyResult = {
  id: string;
  category: (typeof TB_FINAL_GAAP_CATEGORIES)[number];
};

function isAllowedCategory(
  c: string,
): c is (typeof TB_FINAL_GAAP_CATEGORIES)[number] {
  return (TB_FINAL_GAAP_CATEGORIES as readonly string[]).includes(c);
}

function mockClassify(items: ClassifyItem[]): ClassifyResult[] {
  const pool = [...TB_FINAL_GAAP_CATEGORIES] as ClassifyResult["category"][];
  return items.map((it, i) => ({
    id: it.id,
    category: pool[i % pool.length]!,
  }));
}

async function openAiClassify(
  items: ClassifyItem[],
  apiKey: string,
): Promise<ClassifyResult[]> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a US GAAP chart-of-accounts specialist. Given GL accounts that were flagged as ambiguous, assign each to exactly one category from this list: ${TB_FINAL_GAAP_CATEGORIES.join(", ")}. Respond with JSON only: {"results":[{"id":"...","category":"..."}]}`,
        },
        {
          role: "user",
          content: JSON.stringify({ accounts: items }),
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("Empty OpenAI response");
  }

  const parsed = JSON.parse(raw) as {
    results?: { id?: string; category?: string }[];
  };
  const out: ClassifyResult[] = [];
  for (const r of parsed.results ?? []) {
    if (r.id && r.category && isAllowedCategory(r.category)) {
      out.push({ id: r.id, category: r.category });
    }
  }

  if (out.length !== items.length) {
    return mockClassify(items);
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { items?: ClassifyItem[] };
    const items = Array.isArray(body.items) ? body.items : [];

    if (!items.length || items.length > 200) {
      return NextResponse.json(
        { error: "Provide 1–200 items with id, accountNumber, accountName." },
        { status: 400 },
      );
    }

    for (const it of items) {
      if (
        typeof it.id !== "string" ||
        typeof it.accountNumber !== "string" ||
        typeof it.accountName !== "string"
      ) {
        return NextResponse.json(
          { error: "Each item must include id, accountNumber, accountName strings." },
          { status: 400 },
        );
      }
    }

    const key = process.env.OPENAI_API_KEY?.trim();

    if (!key) {
      await new Promise((r) => setTimeout(r, 700));
      return NextResponse.json({ results: mockClassify(items) });
    }

    const results = await openAiClassify(items, key);
    return NextResponse.json({ results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Classification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
