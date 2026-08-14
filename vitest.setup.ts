import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { configure } from '@testing-library/dom';

// Under a full parallel test run, CPU contention can push waitFor()
// resolution past RTL's 1000ms default — give it more headroom.
configure({ asyncUtilTimeout: 20000 });

afterEach(() => {
  cleanup();
});
