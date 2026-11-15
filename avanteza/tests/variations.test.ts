import { test } from "node:test";
import assert from "node:assert/strict";
import { stateWithVariation, stockTarget } from "../src/lib/marketplaces/variations";
import { validatePayload } from "../src/lib/executor/policy";
import { toExecutorPayload } from "../src/lib/ai/schema";

const vars = [
  { id: "101", name: "Azul / P", price: 50, stock: 3, sku: "AZ-P" },
  { id: "102", name: "Azul / M", price: 55, stock: 0, sku: "AZ-M" },
];
const base = { id: "MLB1", title: "Camiseta", status: "active", price: 50, available_quantity: 3 };

test("variações: estado 'antes' foca na variação pedida (limite diário usa o preço dela)", () => {
  const s = stateWithVariation(base, vars, "102");
  assert.equal(s.price, 55);
  assert.equal(s.available_quantity, 0);
  assert.equal(s.variation_name, "Azul / M");
  assert.equal(s.has_variations, true);
  assert.throws(() => stateWithVariation(base, vars, "999"), /não encontrada/);
  assert.equal(stateWithVariation(base, [], undefined).has_variations, false);
});

test("variações: estoque exige variação quando há mais de uma", () => {
  assert.equal(stockTarget([], undefined), null);
  assert.equal(stockTarget([vars[0]], undefined)!.id, "101");
  assert.equal(stockTarget(vars, "102")!.id, "102");
  assert.throws(() => stockTarget(vars, undefined), /informe qual variação/);
});

test("variações: validação do ID e payload vindo da IA", () => {
  assert.equal(validatePayload("update_stock", { available_quantity: 5, variation_id: "174997747229" }), null);
  assert.ok(validatePayload("update_stock", { available_quantity: 5, variation_id: "1; drop" }));
  const p = toExecutorPayload({
    tipo: "update_stock", conta_id: "a", alvo: "MLB1", justificativa: "x", prioridade: "alta", variacao: "102",
    preco: null, estoque: 10, titulo: null, descricao: null, resposta: null, verba: null, status_campanha: null,
    preco_promocional: null, inicio: null, fim: null,
  });
  assert.deepEqual(p, { available_quantity: 10, variation_id: "102" });
});
