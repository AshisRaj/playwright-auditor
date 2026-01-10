/* eslint-disable @typescript-eslint/naming-convention */
export const Patterns = {
  sleep: /(?:await\s+)?(?:page|context|browser)\.(?:waitForTimeout|_waitForTimeout)\(/g,
  fixedTimeout: /timeout\s*:\s*(?:[1-9]\d{3,})/g, // 1000+
  nthLike: /\.(?:first|last|nth)\s*\(/g,
  // Detect usages of locator()/getByText() with long string literals (likely brittle selectors).
  // Match forms like: page.locator('very long text...') or locator("long...") or getByText(`long template`)
  textSelector:
    /(?:\b(?:page|screen|frame|this\.page)\b\.)?(?:locator|getByText)\(\s*(?:`([^`]{25,})`|(["'])([^"']{25,})\2)\s*\)/g,
  testOnly: /test\.(only|fixme)\(/g,
  waitForLoadState: /page\.waitForLoadState\(/g,
};
