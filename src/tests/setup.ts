import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest 未启用 globals,RTL 无法自动注册 cleanup,这里手动挂载。
afterEach(() => {
  cleanup();
});
