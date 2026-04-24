import { toCamelCase, toKebabCase } from '../util/case.ts';

export interface JobTemplateInput {
  readonly moduleName: string;
  readonly jobName: string;
  readonly queueName: string;
}

export const jobTemplate = ({
  jobName,
  queueName,
}: JobTemplateInput): string => {
  const jobKebab = toKebabCase(jobName);
  const queueKebab = toKebabCase(queueName);
  const queueCamel = toCamelCase(queueName);

  return `import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    '${jobKebab}': { id: string };
  }
  interface Queues {
    ${queueCamel}: import('bullmq').Queue<Jobs['${jobKebab}']>;
  }
}

export default createJob<Jobs['${jobKebab}']>(
  '${jobKebab}',
  async (fastify, job) => {
    fastify.log.info(
      { queue: '${queueKebab}', job: '${jobKebab}', id: job.data.id },
      'Handling ${jobKebab}',
    );
    // TODO: resolve services from fastify.diContainer.cradle and do the work
  },
);
`;
};
