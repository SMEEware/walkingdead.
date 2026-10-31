import spec from "./openapi.json";

export type Schema = {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: (string | number)[];
  items?: Schema;
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  required?: string[];
  minimum?: number;
  maximum?: number;
};

export interface Parameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  schema: Schema;
}

export interface Operation {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  scopes: string[];
  ownerOnly: boolean;
  parameters: Parameter[];
  requestBody?: Schema;
  response?: { type: string; schema?: Schema };
}

type RawOperation = {
  operationId: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
  "x-required-scopes"?: string[];
  "x-owner-only"?: boolean;
};

const METHODS = ["get", "post", "put", "delete"] as const;

export const info = spec.info as { title: string; version: string; description: string };
export const tags = (spec as unknown as { tags: { name: string; description: string }[] }).tags;
export const schemas = spec.components.schemas as unknown as Record<string, Schema>;

export const operations: Operation[] = Object.entries(spec.paths as unknown as Record<string, Record<string, RawOperation>>).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((m) => {
    const op = item[m];
    const success = op.responses["200"] ?? op.responses["201"];
    const [type, media] = Object.entries(success?.content ?? {})[0] ?? [];
    return {
      id: op.operationId,
      method: m.toUpperCase(),
      path: `/api/v1${path}`,
      tag: op.tags?.[0] ?? "Other",
      summary: op.summary ?? op.operationId,
      description: op.description ?? "",
      scopes: op["x-required-scopes"] ?? [],
      ownerOnly: !!op["x-owner-only"],
      parameters: op.parameters ?? [],
      requestBody: op.requestBody?.content["application/json"]?.schema,
      response: op.responses["204"] ? { type: "204 No Content" } : type ? { type, schema: media?.schema } : undefined,
    };
  }),
);

export function resolve(schema: Schema | undefined): Schema | undefined {
  if (!schema?.$ref) return schema;
  return schemas[schema.$ref.split("/").pop()!];
}

export function typeLabel(schema: Schema | undefined): string {
  if (!schema) return "any";
  if (schema.$ref) return schema.$ref.split("/").pop()!;
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.type === "array") return `${typeLabel(schema.items)}[]`;
  if (schema.type === "object" && typeof schema.additionalProperties === "object") return `map<string, ${typeLabel(schema.additionalProperties)}>`;
  return schema.format ? `${schema.type} (${schema.format})` : schema.type ?? "any";
}
