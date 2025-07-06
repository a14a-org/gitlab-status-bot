import axios from 'axios';

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
