import { KnownBlock } from '@slack/types';
import { TestResults } from '../services/testLogParser';

const createProgressBar = (percentage: number, width: number = 10): string => {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
};

const getTestStatusEmoji = (passed: number, total: number): string => {
    if (passed === total) return '✅';
    if (passed === 0) return '❌';
    return '⚠️';
};

export const buildTestSummaryBlocks = (testResults: TestResults, jobName: string): KnownBlock[] => {
    const blocks: KnownBlock[] = [];
    
    // Header
    const testStatus = getTestStatusEmoji(testResults.tests.passed, testResults.tests.total);
    const headerText = testResults.tests.failed > 0 
        ? `${testStatus} Test Summary for *${jobName}* - ${testResults.tests.failed} tests failed!`
        : `${testStatus} Test Summary for *${jobName}* - All tests passed!`;
    
    blocks.push({
        type: 'header',
        text: {
            type: 'plain_text',
            text: headerText,
            emoji: true
        }
    });

    // Summary stats
    blocks.push({
        type: 'section',
        fields: [
            {
                type: 'mrkdwn',
                text: `*Test Suites:*\n${testResults.suites.passed}/${testResults.suites.total} passed`
            },
            {
                type: 'mrkdwn',
                text: `*Tests:*\n${testResults.tests.passed}/${testResults.tests.total} passed`
            },
            {
                type: 'mrkdwn',
                text: `*Duration:*\n${testResults.duration}`
            },
            {
                type: 'mrkdwn',
                text: `*Status:*\n${testStatus} ${testResults.tests.failed > 0 ? 'Failed' : 'Passed'}`
            }
        ]
    });

    // Coverage section if available
    if (testResults.coverage) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*📊 Coverage Report:*'
            }
        });

        const coverageFields = [
            {
                type: 'mrkdwn' as const,
                text: `*Statements:*\n${testResults.coverage.statements.percentage.toFixed(2)}% ${createProgressBar(testResults.coverage.statements.percentage)}`
            },
            {
                type: 'mrkdwn' as const,
                text: `*Branches:*\n${testResults.coverage.branches.percentage.toFixed(2)}% ${createProgressBar(testResults.coverage.branches.percentage)}`
            },
            {
                type: 'mrkdwn' as const,
                text: `*Functions:*\n${testResults.coverage.functions.percentage.toFixed(2)}% ${createProgressBar(testResults.coverage.functions.percentage)}`
            },
            {
                type: 'mrkdwn' as const,
                text: `*Lines:*\n${testResults.coverage.lines.percentage.toFixed(2)}% ${createProgressBar(testResults.coverage.lines.percentage)}`
            }
        ];

        blocks.push({
            type: 'section',
            fields: coverageFields
        });
    }

    // Failed tests section if any
    if (testResults.failedTests && testResults.failedTests.length > 0) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*❌ Failed Tests:*'
            }
        });

        // Group failed tests by file
        const failedByFile = testResults.failedTests.reduce((acc, test) => {
            if (!acc[test.file]) {
                acc[test.file] = [];
            }
            acc[test.file].push(test.testName);
            return acc;
        }, {} as Record<string, string[]>);

        for (const [file, tests] of Object.entries(failedByFile)) {
            const testList = tests.map(t => `• ${t}`).join('\n');
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${file}*\n${testList}`
                }
            });
        }
    }

    // Test files summary (collapsible)
    if (testResults.testFiles.length > 0) {
        blocks.push({ type: 'divider' });
        
        // Show first few test files
        const maxFilesToShow = 5;
        const filesToShow = testResults.testFiles.slice(0, maxFilesToShow);
        const remainingFiles = testResults.testFiles.length - maxFilesToShow;
        
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*📄 Test Files:*'
            }
        });

        const fileList = filesToShow.map(file => {
            const emoji = file.status === 'PASS' ? '✅' : '❌';
            const duration = file.duration ? ` (${file.duration})` : '';
            return `${emoji} ${file.name}${duration}`;
        }).join('\n');

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: fileList + (remainingFiles > 0 ? `\n_...and ${remainingFiles} more files_` : '')
            }
        });
    }

    return blocks;
};

export const buildTestSummaryReplacementBlock = (testResults: TestResults | null, jobName: string): KnownBlock => {
    if (!testResults) {
        return {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `❌ *Could not parse test results for ${jobName}*\nThe test output format may not be recognized.`
            }
        };
    }

    // Create a compact summary for inline display
    const testStatus = getTestStatusEmoji(testResults.tests.passed, testResults.tests.total);
    const coverageInfo = testResults.coverage 
        ? `\n📊 Coverage: ${testResults.coverage.statements.percentage.toFixed(1)}% statements, ${testResults.coverage.lines.percentage.toFixed(1)}% lines`
        : '';
    
    const failedInfo = testResults.tests.failed > 0
        ? `\n❌ ${testResults.tests.failed} tests failed`
        : '';

    const summaryText = `${testStatus} *Test Results for ${jobName}*\n` +
        `✓ ${testResults.tests.passed}/${testResults.tests.total} tests passed in ${testResults.duration}` +
        coverageInfo +
        failedInfo;

    return {
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: summaryText
        }
    };
};