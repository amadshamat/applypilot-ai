import { createAiHandler } from './handlers';

/** Lambda entry point for the AI function (bundled by scripts/build-lambda.mjs). */
export const handler = createAiHandler(process.env);
