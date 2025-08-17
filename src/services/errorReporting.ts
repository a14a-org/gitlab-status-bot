import { ErrorReporting } from '@google-cloud/error-reporting';

export interface ErrorGroup {
    groupId: string;
    name: string;
    errorMessage: string;
    count: number;
    affectedServices: string[];
    firstSeen: Date;
    lastSeen: Date;
    representative?: ErrorEvent;
}

export interface ErrorEvent {
    message: string;
    serviceContext?: {
        service?: string;
        version?: string;
    };
    context?: {
        httpRequest?: any;
        user?: string;
        reportLocation?: {
            filePath?: string;
            lineNumber?: number;
            functionName?: string;
        };
    };
    stackTrace?: string;
}

export interface ErrorStats {
    totalErrors: number;
    errorGroups: ErrorGroup[];
    affectedServices: Set<string>;
    timeRange: {
        start: Date;
        end: Date;
    };
}

export class ErrorReportingService {
    private projectId: string;
    private errorReporting: ErrorReporting;

    constructor(projectId?: string) {
        this.projectId = projectId || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
        if (!this.projectId) {
            throw new Error('GCP Project ID not found. Please set GCP_PROJECT_ID environment variable or run on Google Cloud.');
        }
        this.errorReporting = new ErrorReporting({
            projectId: this.projectId,
            // No keyFilename needed on Cloud Run - uses default service account
        });
    }

    async getErrorStats(timeRange: 'PERIOD_1_DAY' | 'PERIOD_7_DAYS' = 'PERIOD_1_DAY'): Promise<ErrorStats> {
        const endTime = new Date();
        const startTime = new Date();
        
        if (timeRange === 'PERIOD_1_DAY') {
            startTime.setDate(startTime.getDate() - 1);
        } else {
            startTime.setDate(startTime.getDate() - 7);
        }

        try {
            // Note: The @google-cloud/error-reporting library is primarily for reporting errors,
            // not for querying them. For querying, we need to use the Cloud Logging API
            // or make direct API calls to the Error Reporting API v1beta1
            
            // On Cloud Run, we can use the metadata service for auth
            const axios = require('axios');
            
            // Get access token from metadata service (works on Cloud Run)
            let accessToken: string;
            try {
                const tokenResponse = await axios.get(
                    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                    {
                        headers: { 'Metadata-Flavor': 'Google' },
                        params: { scopes: 'https://www.googleapis.com/auth/cloud-platform' }
                    }
                );
                accessToken = tokenResponse.data.access_token;
            } catch (metadataError) {
                // Fallback for local development - use gcloud auth
                console.log('Running locally, attempting to use gcloud auth...');
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);
                
                try {
                    const { stdout } = await execAsync('gcloud auth print-access-token');
                    accessToken = stdout.trim();
                } catch (gcloudError) {
                    throw new Error('Unable to obtain access token. Make sure you are either running on GCP or have gcloud configured locally.');
                }
            }
            
            // Get error group stats
            const response = await axios.get(
                `https://clouderrorreporting.googleapis.com/v1beta1/projects/${this.projectId}/groupStats`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                    params: {
                        'timeRange.period': timeRange,
                        'pageSize': 100,
                    },
                }
            );

            const errorGroups: ErrorGroup[] = [];
            const affectedServices = new Set<string>();
            let totalErrors = 0;

            if (response.data.errorGroupStats) {
                for (const groupStat of response.data.errorGroupStats) {
                    const group = groupStat.group;
                    const count = parseInt(groupStat.count || '0');
                    totalErrors += count;

                    const services = groupStat.affectedServices?.map((s: any) => s.service) || [];
                    services.forEach((s: string) => affectedServices.add(s));

                    errorGroups.push({
                        groupId: group.groupId,
                        name: group.name,
                        errorMessage: this.extractErrorMessage(group.name),
                        count: count,
                        affectedServices: services,
                        firstSeen: new Date(groupStat.firstSeenTime),
                        lastSeen: new Date(groupStat.lastSeenTime),
                        representative: groupStat.representative,
                    });
                }
            }

            // Sort by count descending
            errorGroups.sort((a, b) => b.count - a.count);

            return {
                totalErrors,
                errorGroups,
                affectedServices,
                timeRange: {
                    start: startTime,
                    end: endTime,
                },
            };
        } catch (error) {
            console.error('Error fetching error statistics:', error);
            throw error;
        }
    }

    async getErrorGroupDetails(groupId: string): Promise<any> {
        try {
            const axios = require('axios');
            
            // Get access token from metadata service (works on Cloud Run)
            let accessToken: string;
            try {
                const tokenResponse = await axios.get(
                    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                    {
                        headers: { 'Metadata-Flavor': 'Google' },
                        params: { scopes: 'https://www.googleapis.com/auth/cloud-platform' }
                    }
                );
                accessToken = tokenResponse.data.access_token;
            } catch (metadataError) {
                // Fallback for local development
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);
                
                try {
                    const { stdout } = await execAsync('gcloud auth print-access-token');
                    accessToken = stdout.trim();
                } catch (gcloudError) {
                    throw new Error('Unable to obtain access token.');
                }
            }
            
            const response = await axios.get(
                `https://clouderrorreporting.googleapis.com/v1beta1/projects/${this.projectId}/groups/${groupId}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                }
            );

            return response.data;
        } catch (error) {
            console.error('Error fetching error group details:', error);
            throw error;
        }
    }

    private extractErrorMessage(groupName: string): string {
        // Extract the actual error message from the group name
        // Group names often include stack trace info, we want just the message
        const lines = groupName.split('\n');
        return lines[0] || groupName;
    }

    getSeverityFromError(error: ErrorGroup): 'critical' | 'error' | 'warning' {
        // Determine severity based on error characteristics
        const errorMessage = error.errorMessage.toLowerCase();
        
        if (
            errorMessage.includes('database') ||
            errorMessage.includes('connection') ||
            errorMessage.includes('auth') ||
            errorMessage.includes('fatal') ||
            error.count > 100
        ) {
            return 'critical';
        }
        
        if (error.count > 10) {
            return 'error';
        }
        
        return 'warning';
    }
}