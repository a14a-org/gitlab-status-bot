export interface TestResults {
    suites: { total: number; passed: number; failed: number };
    tests: { total: number; passed: number; failed: number };
    duration: string;
    coverage?: {
        statements: { percentage: number; covered: number; total: number };
        branches: { percentage: number; covered: number; total: number };
        functions: { percentage: number; covered: number; total: number };
        lines: { percentage: number; covered: number; total: number };
    };
    testFiles: Array<{
        name: string;
        status: 'PASS' | 'FAIL';
        duration?: string;
    }>;
    failedTests?: Array<{
        file: string;
        testName: string;
        error: string;
    }>;
}

export const parseJestOutput = (logContent: string): TestResults | null => {
    try {
        // Check if this looks like Jest output at all
        const hasJestMarkers = logContent.includes('PASS') || logContent.includes('FAIL') || 
                               logContent.includes('Test Suites:') || logContent.includes('Tests:');
        
        if (!hasJestMarkers) {
            // Try to detect if it's a test that ran but had no output
            if (logContent.includes('Job succeeded') && logContent.length < 1000) {
                // Probably a test job with no actual tests
                return {
                    suites: { total: 0, passed: 0, failed: 0 },
                    tests: { total: 0, passed: 0, failed: 0 },
                    duration: 'N/A',
                    testFiles: []
                };
            }
            return null;
        }

        // Extract test files with their status
        const testFiles: TestResults['testFiles'] = [];
        const testFileRegex = /\s*(PASS|FAIL)\s+(.+?)(?:\s+\(([0-9.]+)\s*s\))?$/gm;
        let match;
        
        while ((match = testFileRegex.exec(logContent)) !== null) {
            testFiles.push({
                name: match[2].trim(),
                status: match[1] as 'PASS' | 'FAIL',
                duration: match[3] ? `${match[3]}s` : undefined
            });
        }

        // Extract test summary
        const summaryRegex = /Test Suites:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/;
        const testRegex = /Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/;
        const timeRegex = /Time:\s*([0-9.]+)\s*s/;

        const suiteMatch = logContent.match(summaryRegex);
        const testMatch = logContent.match(testRegex);
        const timeMatch = logContent.match(timeRegex);

        if (!suiteMatch || !testMatch) {
            // If we found test files but no summary, create a summary from the files
            if (testFiles.length > 0) {
                const passedFiles = testFiles.filter(f => f.status === 'PASS').length;
                const failedFiles = testFiles.filter(f => f.status === 'FAIL').length;
                
                return {
                    suites: { 
                        total: testFiles.length, 
                        passed: passedFiles, 
                        failed: failedFiles 
                    },
                    tests: { 
                        total: testFiles.length, 
                        passed: passedFiles, 
                        failed: failedFiles 
                    },
                    duration: timeMatch ? `${timeMatch[1]}s` : 'N/A',
                    testFiles
                };
            }
            return null;
        }

        const suites = {
            failed: parseInt(suiteMatch[1] || '0'),
            passed: parseInt(suiteMatch[2] || suiteMatch[3]),
            total: parseInt(suiteMatch[3])
        };

        const tests = {
            failed: parseInt(testMatch[1] || '0'),
            passed: parseInt(testMatch[2] || testMatch[3]),
            total: parseInt(testMatch[3])
        };

        // Extract coverage data
        let coverage: TestResults['coverage'];
        const coverageRegex = /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/;
        const coverageMatch = logContent.match(coverageRegex);
        
        if (coverageMatch) {
            // Also try to extract detailed coverage info
            const coverageTableRegex = /^(.+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/gm;
            let totalStats = { stmts: 0, stmtsCovered: 0, branches: 0, branchesCovered: 0, funcs: 0, funcsCovered: 0, lines: 0, linesCovered: 0 };
            let fileCount = 0;
            
            let covMatch;
            while ((covMatch = coverageTableRegex.exec(logContent)) !== null) {
                if (covMatch[1].trim() !== 'File' && covMatch[1].trim() !== 'All files' && !covMatch[1].includes('------')) {
                    fileCount++;
                }
            }

            coverage = {
                statements: { 
                    percentage: parseFloat(coverageMatch[1]), 
                    covered: 0, 
                    total: 0 
                },
                branches: { 
                    percentage: parseFloat(coverageMatch[2]), 
                    covered: 0, 
                    total: 0 
                },
                functions: { 
                    percentage: parseFloat(coverageMatch[3]), 
                    covered: 0, 
                    total: 0 
                },
                lines: { 
                    percentage: parseFloat(coverageMatch[4]), 
                    covered: 0, 
                    total: 0 
                }
            };
        }

        // Extract failed test details if any
        const failedTests: TestResults['failedTests'] = [];
        if (tests.failed > 0) {
            const failureRegex = /FAIL\s+(.+?)\n([\s\S]*?)(?=(?:PASS|FAIL|Test Suites:|$))/g;
            let failMatch;
            
            while ((failMatch = failureRegex.exec(logContent)) !== null) {
                const fileName = failMatch[1].trim();
                const failureContent = failMatch[2];
                
                // Try to extract individual test failures
                const testFailureRegex = /✕\s+(.+?)(?:\s+\(\d+\s*ms\))?$/gm;
                let testFailMatch;
                
                while ((testFailMatch = testFailureRegex.exec(failureContent)) !== null) {
                    failedTests.push({
                        file: fileName,
                        testName: testFailMatch[1].trim(),
                        error: 'Test failed' // Could be enhanced to extract actual error messages
                    });
                }
            }
        }

        return {
            suites,
            tests,
            duration: timeMatch ? `${timeMatch[1]}s` : 'N/A',
            coverage,
            testFiles,
            failedTests: failedTests.length > 0 ? failedTests : undefined
        };
    } catch (error) {
        console.error('Error parsing Jest output:', error);
        return null;
    }
};

export const isTestJob = (jobName: string): boolean => {
    const testJobPatterns = [
        /test/i,
        /jest/i,
        /spec/i,
        /unit/i,
        /integration/i,
        /e2e/i,
        /coverage/i
    ];
    
    return testJobPatterns.some(pattern => pattern.test(jobName));
};