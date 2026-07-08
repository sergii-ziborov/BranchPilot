import type {
  BeautifiedFile,
  FileBeautifyRequest
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import {
  FILE_BEAUTIFY_SCHEMA,
  MAX_ASSISTANT_BEAUTIFY_BYTES
} from '../assistantRunner.schemas.js'
import { buildFileBeautifyPrompt } from '../assistantRunner.prompts.js'
import { parseBeautifiedFile } from '../assistantRunner.parsers.js'
import { resolveRepositoryRoot } from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

export async function beautifyFileWithAssistant(
  runner: CommandRunner,
  request: FileBeautifyRequest
): Promise<BeautifiedFile> {
  await resolveRepositoryRoot(runner, request.repoPath)
  const textBytes = Buffer.byteLength(request.text, 'utf8')

  if (textBytes > MAX_ASSISTANT_BEAUTIFY_BYTES) {
    throw new BranchPilotUserError(
      'assistant_input_too_large',
      'File is too large for AI beautify.',
      'Use local Beautify or format a smaller file section.'
    )
  }

  const prompt = buildFileBeautifyPrompt({
    filePath: request.filePath,
    content: request.text
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, FILE_BEAUTIFY_SCHEMA)

  return {
    content: parseBeautifiedFile(output),
    assistant: assistant.id,
    truncated: false
  }
}
