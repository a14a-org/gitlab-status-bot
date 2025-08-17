import { KnownBlock, Button, SectionBlock } from '@slack/types';
import { AggregatedErrorReport, ErrorTrend } from '../services/errorAggregator';
import { ErrorGroup } from '../services/errorReporting';

export class ErrorReportMessageBuilder {
    private report: AggregatedErrorReport;
    private projectId: string;

    constructor(report: AggregatedErrorReport, projectId: string) {
        this.report = report;
        this.projectId = projectId;
    }

    buildMessage(): { blocks: KnownBlock[]; text: string } {
        const blocks: KnownBlock[] = [];
        
        // Header
        blocks.push(this.buildHeader());
        
        // Summary section
        blocks.push(...this.buildSummary());
        
        // Divider
        blocks.push({ type: 'divider' });
        
        // Critical errors section
        if (this.report.bySeverity.critical.length > 0) {
            blocks.push(...this.buildSeveritySection('critical', this.report.bySeverity.critical));
        }
        
        // Top errors section
        if (this.report.bySeverity.error.length > 0) {
            blocks.push(...this.buildSeveritySection('error', this.report.bySeverity.error.slice(0, 5)));
        }
        
        // Service distribution
        blocks.push(...this.buildServiceDistribution());
        
        // Hourly trend
        blocks.push(this.buildHourlyTrend());
        
        // Actions
        blocks.push(this.buildActions());
        
        return {
            blocks,
            text: `Daily Error Report: ${this.report.summary.totalErrors} errors from ${this.report.summary.affectedServices.length} services`,
        };
    }

    private buildHeader(): KnownBlock {
        const now = new Date();
        const timeString = now.toLocaleString('en-US', {
            timeZone: 'Europe/Berlin',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
        });
        const dateString = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        return {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '☁️ Daily Error Report - CJP Platform',
                emoji: true,
            },
        };
    }

    private buildSummary(): KnownBlock[] {
        const { summary } = this.report;
        const trendEmoji = this.getTrendEmoji(summary.trend.trend);
        const trendText = this.formatTrendText(summary.trend);

        const blocks: KnownBlock[] = [];
        
        // Date and time context
        const now = new Date();
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `📅 ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} | ${now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin', timeZoneName: 'short' })}`,
                },
            ],
        });

        // Summary metrics
        const summaryFields = [
            `*Total Errors:* ${summary.totalErrors} ${trendText}`,
            `*Error Groups:* ${summary.totalErrorGroups}`,
            `*Affected Services:* ${summary.affectedServices.length}`,
            `*New Error Types:* ${summary.newErrorGroups.length}`,
        ];

        blocks.push({
            type: 'section',
            fields: summaryFields.map(text => ({ type: 'mrkdwn', text })),
        });

        return blocks;
    }

    private buildSeveritySection(severity: 'critical' | 'error' | 'warning', errors: ErrorGroup[]): KnownBlock[] {
        if (errors.length === 0) return [];

        const blocks: KnownBlock[] = [];
        const emoji = this.getSeverityEmoji(severity);
        const title = `${emoji} ${this.capitalize(severity)} Errors (${errors.length})`;

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${title}*`,
            },
        });

        for (const error of errors.slice(0, 3)) {
            const serviceName = error.affectedServices[0] || 'unknown';
            const isNew = this.report.summary.newErrorGroups.some(e => e.groupId === error.groupId);
            const newBadge = isNew ? ' 🆕' : '';
            
            const errorBlock: SectionBlock = {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${this.truncateErrorMessage(error.errorMessage)}*${newBadge}\n` +
                          `Count: ${error.count} | Service: ${serviceName}`,
                },
            };

            // Add view details button for critical errors
            if (severity === 'critical') {
                errorBlock.accessory = {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'View Details',
                        emoji: true,
                    },
                    action_id: `view_error_${error.groupId}`,
                    value: error.groupId,
                };
            }

            blocks.push(errorBlock);
        }

        return blocks;
    }

    private buildServiceDistribution(): KnownBlock[] {
        const blocks: KnownBlock[] = [];
        
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*🟠 Errors by Service*',
            },
        });

        const maxErrors = Math.max(...Array.from(this.report.byService.values()).map(s => s.errorCount));
        const barLength = 12;
        
        let serviceText = '```\n';
        let count = 0;
        for (const [service, data] of this.report.byService) {
            if (count >= 5) break; // Show top 5 services
            
            const barFilled = Math.round((data.errorCount / maxErrors) * barLength);
            const bar = '█'.repeat(barFilled) + '░'.repeat(barLength - barFilled);
            
            serviceText += `${service.padEnd(20)} ${bar} ${data.errorCount}\n`;
            count++;
        }
        serviceText += '```';

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: serviceText,
            },
        });

        return blocks;
    }

    private buildHourlyTrend(): KnownBlock {
        const distribution = this.report.hourlyDistribution;
        const maxCount = Math.max(...Array.from(distribution.values()));
        
        let trendText = '📈 *24-Hour Distribution*\n```\n';
        
        // Build the sparkline
        const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
        let sparkline = '';
        
        for (let hour = 0; hour < 24; hour++) {
            const count = distribution.get(hour) || 0;
            const level = maxCount > 0 ? Math.floor((count / maxCount) * 7) : 0;
            sparkline += sparkChars[level];
        }
        
        trendText += `00:00 ${sparkline} 23:59\n`;
        trendText += '```';
        
        return {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: trendText,
            },
        };
    }

    private buildActions(): KnownBlock {
        const consoleUrl = `https://console.cloud.google.com/errors;time=P1D;locations=global?project=${this.projectId}`;
        
        return {
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'View in Cloud Console',
                        emoji: true,
                    },
                    url: consoleUrl,
                    action_id: 'view_console',
                },
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'Configure Alerts',
                        emoji: true,
                    },
                    action_id: 'configure_alerts',
                    value: 'configure',
                },
            ],
        };
    }

    private getTrendEmoji(trend: 'up' | 'down' | 'stable' | 'new'): string {
        switch (trend) {
            case 'up': return '📈';
            case 'down': return '📉';
            case 'stable': return '➡️';
            case 'new': return '🆕';
        }
    }

    private getSeverityEmoji(severity: 'critical' | 'error' | 'warning'): string {
        switch (severity) {
            case 'critical': return '🔴';
            case 'error': return '🟠';
            case 'warning': return '🟡';
        }
    }

    private formatTrendText(trend: ErrorTrend): string {
        if (trend.trend === 'new') return '';
        
        const arrow = trend.trend === 'up' ? '↑' : trend.trend === 'down' ? '↓' : '→';
        const percentage = Math.abs(trend.percentageChange);
        const sign = trend.percentageChange > 0 ? '+' : '-';
        
        if (trend.trend === 'stable') {
            return `(→ stable)`;
        }
        
        return `(${arrow} ${sign}${percentage}% from yesterday)`;
    }

    private truncateErrorMessage(message: string, maxLength: number = 80): string {
        if (message.length <= maxLength) return message;
        return message.substring(0, maxLength - 3) + '...';
    }

    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

export async function buildErrorReportMessage(report: AggregatedErrorReport, projectId: string): Promise<{ blocks: KnownBlock[]; text: string }> {
    const builder = new ErrorReportMessageBuilder(report, projectId);
    return builder.buildMessage();
}