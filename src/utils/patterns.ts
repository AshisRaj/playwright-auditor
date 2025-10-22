/* eslint-disable @typescript-eslint/naming-convention */
export const Patterns = {
  sleep: /(?:await\s+)?(?:page|context|browser)\.(?:waitForTimeout|_waitForTimeout)\(/g,
  fixedTimeout: /timeout\s*:\s*(?:[1-9]\d{3,})/g, // 1000+
  nthLike: /\.(?:first|last|nth)\s*\(/g,
  textSelector: /page\.(?:locator|getByText)\(\s*`?['"][^)]{25,}['"`]\s*\)/g, // long brittle text
  testOnly: /test\.(only|fixme)\(/g,
  waitForLoadState: /page\.waitForLoadState\(/g,
};
