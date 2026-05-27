#!/usr/bin/env node
import { main } from '@astur/cli';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
