import axios from 'axios';
import { parseJestOutput, TestResults } from './testLogParser';

const gitlabApi = axios.create({
    baseURL: `${process.env.GITLAB_BASE_URL}/api/v4`,
    headers: {
        'PRIVATE-TOKEN': process.env.GITLAB_API_TOKEN,
    },
});

export const getJobLog = async (jobId: number): Promise<string> => {
    try {
        const response = await gitlabApi.get(`/projects/${process.env.GITLAB_PROJECT_ID}/jobs/${jobId}/trace`);
        // Return the last 20 lines of the log for brevity
        const logs = response.data.toString().split('\n');
        const last20Lines = logs.slice(-20).join('\n');
        return "```\n" + last20Lines + "\n```";
    } catch (error) {
        console.error('Error fetching GitLab job log:', error);
        return 'Could not retrieve job log.';
    }
};

export const getJobTestResults = async (jobId: number): Promise<TestResults | null> => {
    try {
        const response = await gitlabApi.get(`/projects/${process.env.GITLAB_PROJECT_ID}/jobs/${jobId}/trace`);
        const fullLog = response.data.toString();
        
        // Parse the log to extract test results
        const testResults = parseJestOutput(fullLog);
        return testResults;
    } catch (error) {
        console.error('Error fetching GitLab job test results:', error);
        return null;
    }
};

export const getJobFullLog = async (jobId: number): Promise<string> => {
    try {
        const response = await gitlabApi.get(`/projects/${process.env.GITLAB_PROJECT_ID}/jobs/${jobId}/trace`);
        return response.data.toString();
    } catch (error) {
        console.error('Error fetching GitLab job full log:', error);
        return '';
    }
};
