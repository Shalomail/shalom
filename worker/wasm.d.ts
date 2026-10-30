// Módulos .wasm importados pelo Worker (o wrangler entrega já compilados).
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
