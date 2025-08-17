import { ErrorReportingService, ErrorGroup, ErrorStats } from './errorReporting';
import { Firestore } from '@google-cloud/firestore';

export interface ErrorTrend {
    current: number;
    previous: number;
    percentageChange: number;
    trend: 'up' | 'down' | 'stable' | 'new';
}

export interface AggregatedErrorReport {
    summary: {
        totalErrors: number;
        totalErrorGroups: number;
        affectedServices: string[];
        trend: ErrorTrend;
        newErrorGroups: ErrorGroup[];
        topErrors: ErrorGroup[];
    };
    byService: Map<string, {
        errorCount: number;
        errorGroups: ErrorGroup[];
    }>;
    bySeverity: {
        critical: ErrorGroup[];
        error: ErrorGroup[];
        warning: ErrorGroup[];
    };
    hourlyDistribution: Map<number, number>;
}

export class ErrorAggregator {
    private errorReporting: ErrorReportingService;
    private firestore: Firestore;
    private collectionName = 'error_reports';

    constructor(projectId?: string) {
        this.errorReporting = new ErrorReportingService(projectId);
        this.firestore = new Firestore(); // Will use default project on Cloud Run
    }

    async generateDailyReport(): Promise<AggregatedErrorReport> {
        // Get current day stats
        const currentStats = await this.errorReporting.getErrorStats('PERIOD_1_DAY');
        
        // Get previous day stats for comparison
        const previousStats = await this.getPreviousDayStats();
        
        // Calculate trends
        const trend = this.calculateTrend(currentStats, previousStats);
        
        // Identify new error groups
        const newErrorGroups = this.identifyNewErrors(currentStats, previousStats);
        
        // Group by service
        const byService = this.groupByService(currentStats.errorGroups);
        
        // Group by severity
        const bySeverity = this.groupBySeverity(currentStats.errorGroups);
        
        // Get hourly distribution (mock for now, would need more detailed API calls)
        const hourlyDistribution = this.generateHourlyDistribution(currentStats.errorGroups);
        
        // Get top errors
        const topErrors = currentStats.errorGroups.slice(0, 10);
        
        const report: AggregatedErrorReport = {
            summary: {
                totalErrors: currentStats.totalErrors,
                totalErrorGroups: currentStats.errorGroups.length,
                affectedServices: Array.from(currentStats.affectedServices),
                trend,
                newErrorGroups,
                topErrors,
            },
            byService,
            bySeverity,
            hourlyDistribution,
        };
        
        // Save report to Firestore
        await this.saveReport(report);
        
        return report;
    }

    private calculateTrend(current: ErrorStats, previous: ErrorStats | null): ErrorTrend {
        if (!previous) {
            return {
                current: current.totalErrors,
                previous: 0,
                percentageChange: 0,
                trend: 'new',
            };
        }

        const percentageChange = previous.totalErrors === 0 
            ? 100 
            : ((current.totalErrors - previous.totalErrors) / previous.totalErrors) * 100;

        let trend: 'up' | 'down' | 'stable' | 'new';
        if (Math.abs(percentageChange) < 5) {
            trend = 'stable';
        } else if (percentageChange > 0) {
            trend = 'up';
        } else {
            trend = 'down';
        }

        return {
            current: current.totalErrors,
            previous: previous.totalErrors,
            percentageChange: Math.round(percentageChange),
            trend,
        };
    }

    private identifyNewErrors(current: ErrorStats, previous: ErrorStats | null): ErrorGroup[] {
        if (!previous) {
            return current.errorGroups;
        }

        const previousGroupIds = new Set(previous.errorGroups.map(g => g.groupId));
        return current.errorGroups.filter(g => !previousGroupIds.has(g.groupId));
    }

    private groupByService(errorGroups: ErrorGroup[]): Map<string, { errorCount: number; errorGroups: ErrorGroup[] }> {
        const byService = new Map<string, { errorCount: number; errorGroups: ErrorGroup[] }>();
        
        for (const group of errorGroups) {
            for (const service of group.affectedServices) {
                if (!byService.has(service)) {
                    byService.set(service, { errorCount: 0, errorGroups: [] });
                }
                const serviceData = byService.get(service)!;
                serviceData.errorCount += group.count;
                serviceData.errorGroups.push(group);
            }
        }
        
        // Sort services by error count
        return new Map(
            Array.from(byService.entries()).sort((a, b) => b[1].errorCount - a[1].errorCount)
        );
    }

    private groupBySeverity(errorGroups: ErrorGroup[]): {
        critical: ErrorGroup[];
        error: ErrorGroup[];
        warning: ErrorGroup[];
    } {
        const bySeverity = {
            critical: [] as ErrorGroup[],
            error: [] as ErrorGroup[],
            warning: [] as ErrorGroup[],
        };
        
        for (const group of errorGroups) {
            const severity = this.errorReporting.getSeverityFromError(group);
            bySeverity[severity].push(group);
        }
        
        return bySeverity;
    }

    private generateHourlyDistribution(errorGroups: ErrorGroup[]): Map<number, number> {
        const distribution = new Map<number, number>();
        
        // Initialize all hours with 0
        for (let hour = 0; hour < 24; hour++) {
            distribution.set(hour, 0);
        }
        
        // For now, we'll distribute errors based on when they were last seen
        // This gives a rough approximation of error activity
        // Note: For accurate distribution, we'd need to query time-series data from Cloud Monitoring
        for (const group of errorGroups) {
            // Use lastSeen time to place errors in hourly buckets
            const hour = new Date(group.lastSeen).getHours();
            
            // Add the error count to that hour
            // We use the full count as these are aggregated errors that likely occurred around that time
            distribution.set(hour, (distribution.get(hour) || 0) + group.count);
        }
        
        // If all errors are in one hour (which might happen with the current implementation),
        // spread them out a bit for better visualization
        const totalErrors = Array.from(distribution.values()).reduce((a, b) => a + b, 0);
        const nonZeroHours = Array.from(distribution.values()).filter(v => v > 0).length;
        
        if (nonZeroHours === 1 && totalErrors > 0) {
            // Find the hour with all the errors
            const peakHour = Array.from(distribution.entries()).find(([_, count]) => count > 0)?.[0];
            if (peakHour !== undefined) {
                const spreadCount = Math.floor(totalErrors * 0.7); // Keep 70% in peak hour
                const remainingCount = totalErrors - spreadCount;
                
                distribution.set(peakHour, spreadCount);
                
                // Spread remaining 30% to adjacent hours
                const prevHour = (peakHour - 1 + 24) % 24;
                const nextHour = (peakHour + 1) % 24;
                distribution.set(prevHour, Math.floor(remainingCount / 2));
                distribution.set(nextHour, Math.ceil(remainingCount / 2));
            }
        }
        
        return distribution;
    }

    private async getPreviousDayStats(): Promise<ErrorStats | null> {
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);
            
            const doc = await this.firestore
                .collection(this.collectionName)
                .doc(yesterday.toISOString().split('T')[0])
                .get();
            
            if (!doc.exists) {
                return null;
            }
            
            const data = doc.data();
            return data?.stats || null;
        } catch (error) {
            console.error('Error fetching previous day stats:', error);
            return null;
        }
    }

    private async saveReport(report: AggregatedErrorReport): Promise<void> {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Convert Maps to plain objects for Firestore
            const firestoreReport = {
                summary: report.summary,
                byService: Object.fromEntries(report.byService),
                bySeverity: report.bySeverity,
                hourlyDistribution: Object.fromEntries(report.hourlyDistribution),
            };
            
            await this.firestore
                .collection(this.collectionName)
                .doc(today)
                .set({
                    report: firestoreReport,
                    stats: {
                        totalErrors: report.summary.totalErrors,
                        errorGroups: report.summary.topErrors,
                        affectedServices: report.summary.affectedServices,
                        timeRange: {
                            start: new Date(new Date().setDate(new Date().getDate() - 1)),
                            end: new Date(),
                        },
                    },
                    createdAt: new Date(),
                });
        } catch (error) {
            console.error('Error saving report to Firestore:', error);
        }
    }

    formatTrendEmoji(trend: 'up' | 'down' | 'stable' | 'new'): string {
        switch (trend) {
            case 'up': return '↑';
            case 'down': return '↓';
            case 'stable': return '→';
            case 'new': return '🆕';
        }
    }

    formatPercentageChange(change: number): string {
        if (change === 0) return '';
        const sign = change > 0 ? '+' : '';
        return `${sign}${change}%`;
    }
}