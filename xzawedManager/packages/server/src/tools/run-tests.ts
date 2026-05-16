import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { RedisAgentHandler } from './redis-agent-handler.js'

interface RunTestsInput {
  projectPath: string
  context: Record<string, unknown>
  testFiles?: string[]
  testCommand?: string
}

interface TestFailure {
  file: string
  testName: string
  message: string
  suggestion: string
}

interface RunTestsOutput {
  success: boolean
  passed: number
  failed: number
  failures: TestFailure[]
  duration: number
  content: string
}

const inputSchema = {
  type: 'object' as const,
  properties: {
    projectPath: { type: 'string', description: 'Absolute path to the project root' },
    testFiles: { type: 'array', items: { type: 'string' }, description: 'Specific test files to run (optional)' },
    testCommand: { type: 'string', description: 'Override test command (optional, auto-detected if omitted)' },
    context: { type: 'object', description: 'Additional context for test execution' },
  },
  required: ['projectPath', 'context'],
}

const testFailureSchema = z.object({
  file: z.string(),
  testName: z.string(),
  message: z.string(),
  suggestion: z.string(),
})

const outputSchema = z.object({
  success: z.boolean().default(false),
  passed: z.number().default(0),
  failed: z.number().default(0),
  failures: z.array(testFailureSchema).default([]),
  duration: z.number().default(0),
  content: z.string().default(''),
})

export function createRunTestsHandler(redisUrl: string): ToolHandler<RunTestsInput, RunTestsOutput> {
  return new RedisAgentHandler<RunTestsInput, RunTestsOutput>(
    redisUrl,
    'tester',
    'test_request',
    'test_complete',
    'run_tests',
    'Execute test suites in the specified project and analyze failures',
    inputSchema,
    outputSchema as z.ZodType<RunTestsOutput>,
  )
}
