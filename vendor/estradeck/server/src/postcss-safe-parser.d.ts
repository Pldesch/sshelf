declare module 'postcss-safe-parser' {
  import type { Root } from 'postcss';
  const safeParse: (css: string, opts?: unknown) => Root;
  export default safeParse;
}
