/*
 * AI module registrations: assistant tools + prompt templates. Imported by `engines.ts`.
 * Other modules add AI capabilities with `registerAiTool` / `registerAiPrompt` /
 * `registerStudentInsightSource` from their own registrations files.
 */
import './ai.prompts';
import './ai.tools';

export { registerStudentInsightSource } from './ai.insights';
