export function formatErrorDetailsForSlack(errorDetails: any, projectId: string): string {
    const { group, recentEvents } = errorDetails;
    
    // Extract key information
    const errorMessage = extractErrorMessage(group.name);
    const groupId = group.groupId;
    
    // Build the message
    let message = `🔍 *Error Details*\n\n`;
    
    // Error message
    message += `*Error:* \`${errorMessage}\`\n`;
    
    // Group ID
    message += `*Group ID:* ${groupId}\n`;
    
    // Tracking issue URL if available
    if (group.trackingIssues && group.trackingIssues.length > 0) {
        const issue = group.trackingIssues[0];
        message += `*Tracking Issue:* <${issue.url}|${issue.url}>\n`;
    }
    
    message += `\n`;
    
    // Recent occurrences
    if (recentEvents && recentEvents.length > 0) {
        message += `*Recent Occurrences (last ${recentEvents.length}):*\n`;
        
        for (const event of recentEvents.slice(0, 3)) {  // Show max 3 events
            const timestamp = new Date(event.eventTime).toLocaleString('en-US', {
                timeZone: 'Europe/Berlin',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
            
            message += `• ${timestamp}`;
            
            // Add service/version info if available
            if (event.serviceContext) {
                const { service, version } = event.serviceContext;
                if (service) message += ` | Service: ${service}`;
                if (version) message += ` v${version}`;
            }
            
            // Add user info if available
            if (event.context?.user) {
                message += ` | User: ${event.context.user}`;
            }
            
            message += `\n`;
            
            // Add HTTP context if available
            if (event.context?.httpRequest) {
                const req = event.context.httpRequest;
                if (req.url) {
                    message += `  └─ ${req.method || 'GET'} ${truncateUrl(req.url)}\n`;
                }
            }
        }
    } else {
        message += `*Recent Occurrences:* No recent events found\n`;
    }
    
    message += `\n`;
    
    // Sample stack trace (if available)
    if (recentEvents && recentEvents.length > 0 && recentEvents[0].message) {
        const stackLines = recentEvents[0].message.split('\n');
        const relevantLines = extractRelevantStackLines(stackLines);
        
        if (relevantLines.length > 0) {
            message += `*Stack Trace (excerpt):*\n\`\`\`\n`;
            message += relevantLines.join('\n');
            message += `\n\`\`\`\n\n`;
        }
    }
    
    // Add link to Cloud Console
    const consoleUrl = `https://console.cloud.google.com/errors/detail/${encodeURIComponent(groupId)};time=P7D?project=${projectId}`;
    message += `🔗 <${consoleUrl}|View Full Details in Cloud Console>`;
    
    return message;
}

function extractErrorMessage(groupName: string): string {
    // Group names often include stack trace info, extract just the error message
    const lines = groupName.split('\n');
    const firstLine = lines[0] || groupName;
    
    // Remove common prefixes
    return firstLine
        .replace(/^Error:\s*/i, '')
        .replace(/^Exception:\s*/i, '')
        .replace(/^TypeError:\s*/i, '')
        .replace(/^ReferenceError:\s*/i, '')
        .trim();
}

function truncateUrl(url: string, maxLength: number = 60): string {
    if (url.length <= maxLength) return url;
    
    // Try to keep the domain and some path context
    const urlParts = url.split('?')[0];  // Remove query params for brevity
    if (urlParts.length <= maxLength) return urlParts + '...';
    
    return urlParts.substring(0, maxLength - 3) + '...';
}

function extractRelevantStackLines(lines: string[], maxLines: number = 5): string[] {
    const relevant: string[] = [];
    
    for (const line of lines) {
        // Skip empty lines and very long lines
        if (!line.trim() || line.length > 200) continue;
        
        // Include lines that look like stack frames or error messages
        if (line.includes('at ') || 
            line.includes('Error') || 
            line.includes('Exception') ||
            line.match(/^\s*\//) ||  // File paths
            line.match(/:\d+:\d+/)) {  // Line:column numbers
            
            relevant.push(line.substring(0, 120));  // Truncate long lines
            
            if (relevant.length >= maxLines) break;
        }
    }
    
    return relevant;
}