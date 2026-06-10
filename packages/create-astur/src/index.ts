#!/usr/bin/env node
import { main } from '@astur-mobile/cli';

main(['init']).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
