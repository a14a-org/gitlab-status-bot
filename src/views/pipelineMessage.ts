import { KnownBlock, Button } from '@slack/types';
import { isTestJob } from '../services/testLogParser';

const mapStatusToEmoji = (status: string): string => {
    switch (status) {
        case 'success':
            return '✅';
        case 'failed':
            return '❌';
        case 'running':
            return '⚙️';
        case 'pending':
            return '⏳';
        case 'created':
            return '📝';
        default:
            return '❓';
    }
};

const getStageStatus = (builds: any[]): 'failed' | 'running' | 'success' | 'pending' => {
    if (builds.some((b) => b.status === 'failed')) {
        return 'failed';
    }
    if (builds.every((b) => b.status === 'success')) {
        return 'success';
    }
    if (builds.every((b) => b.status === 'created' || b.status === 'pending')) {
        return 'pending';
    }
    return 'running';
};

export const buildPipelineMessageBlocks = (
    pipelineData: any,
    expandedStages: Set<string>
): KnownBlock[] => {
    const { object_attributes, project, commit, builds } = pipelineData;
    const stages: string[] = object_attributes.stages;
    const pipelineId = object_attributes.id;

    const headerBlock: KnownBlock = {
        type: 'header',
        text: {
            type: 'plain_text',
            text: `Deployment for ${project.name}`,
            emoji: true,
        },
    };

    const contextBlock: KnownBlock = {
        type: 'context',
        elements: [
            {
                type: 'mrkdwn',
                text: `*Branch:* ${object_attributes.ref} | *Commit:* <${commit.url}|${commit.id.slice(0, 8)}> by ${commit.author.name}`,
            },
        ],
    };

    const blocks: KnownBlock[] = [headerBlock, contextBlock, { type: 'divider' }];

    const buildsByStage = new Map<string, any[]>();
    for (const build of builds) {
        if (!buildsByStage.has(build.stage)) {
            buildsByStage.set(build.stage, []);
        }
        buildsByStage.get(build.stage)!.push(build);
    }

    for (const stageName of stages) {
        const stageBuilds = buildsByStage.get(stageName);
        
        // If no builds exist for this stage yet, it hasn't started
        if (!stageBuilds || stageBuilds.length === 0) {
            blocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `⏳ *${stageName}*` },
            });
            continue;
        }

        const stageStatus = getStageStatus(stageBuilds);
        const stageEmoji = mapStatusToEmoji(stageStatus);
        const isExpanded = expandedStages.has(stageName);

        const button: Button = {
            type: 'button',
            text: {
                type: 'plain_text',
                text: isExpanded ? 'Hide' : 'Show',
                emoji: true,
            },
            action_id: isExpanded ? 'hide_stage' : 'show_stage',
            value: JSON.stringify({ stageName, pipelineId }),
        };

        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `${stageEmoji} *${stageName}*` },
            accessory: button,
        });

        if (isExpanded) {
            const jobFields = stageBuilds.map((build) => ({
                type: 'mrkdwn' as const,
                text: `${mapStatusToEmoji(build.status)} *${build.name}:* ${build.status}`,
            }));

            for (let i = 0; i < jobFields.length; i += 10) {
                blocks.push({
                    type: 'section',
                    fields: jobFields.slice(i, i + 10),
                });
            }
        }
    }

    const failedBuilds = builds.filter((build: any) => build.status === 'failed');
    const successfulTestBuilds = builds.filter((build: any) => 
        build.status === 'success' && isTestJob(build.name)
    );
    
    if (failedBuilds.length > 0 || successfulTestBuilds.length > 0) {
        blocks.push({ type: 'divider' });

        const actionButtons: Button[] = [];
        
        // Add error log buttons for failed builds
        failedBuilds.forEach((build: any) => {
            actionButtons.push({
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: `Log: ${build.name}`,
                    emoji: true,
                },
                style: 'danger',
                action_id: 'show_error_log',
                value: String(build.id),
            });
        });
        
        // Add test summary buttons for successful test builds
        successfulTestBuilds.forEach((build: any) => {
            actionButtons.push({
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: `📊 ${build.name}`,
                    emoji: true,
                },
                style: 'primary',
                action_id: 'show_test_summary',
                value: JSON.stringify({ jobId: build.id, jobName: build.name }),
            });
        });

        // Also add test summary buttons for failed test builds
        const failedTestBuilds = failedBuilds.filter((build: any) => isTestJob(build.name));
        failedTestBuilds.forEach((build: any) => {
            actionButtons.push({
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: `📊 ${build.name}`,
                    emoji: true,
                },
                style: 'danger',
                action_id: 'show_test_summary',
                value: JSON.stringify({ jobId: build.id, jobName: build.name }),
            });
        });

        for (let i = 0; i < actionButtons.length; i += 5) {
            const chunk = actionButtons.slice(i, i + 5);
            blocks.push({
                type: 'actions',
                elements: chunk,
            });
        }
    }

    return blocks;
};
