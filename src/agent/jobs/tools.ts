// The tools a run advertises to the model (D32). Each job's base set, in table order, with the
// registry's own name, description and schema. Main's gate still decides every call (D30), so
// this list is what the model may ask for, not what it may run.

import { BASE_TOOLS } from '../../shared/jobs';
import type { JobId } from '../../shared/agent-protocol';
import { TOOL_SPECS } from '../../shared/tools';
import type { ToolDefinition } from '../provider/types';

/** The job's base tools as the provider sees them: the registry's name, description and schema. */
export function jobToolDefinitions(job: JobId): ToolDefinition[] {
  return BASE_TOOLS[job].map((name) => {
    const spec = TOOL_SPECS[name];
    return {
      name: spec.name,
      description: spec.description,
      // A copy, so a caller that edits its definition cannot change the registry.
      parameters: structuredClone(spec.parameters) as unknown as ToolDefinition['parameters'],
    };
  });
}
