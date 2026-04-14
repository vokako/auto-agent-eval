import type { JobSummary, JobDetail, TaskDetail, CompareResult } from "../types";

const BASE = import.meta.env.DEV ? "http://localhost:8080" : "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  jobs: () => get<JobSummary[]>("/api/jobs"),
  job: (id: string) => get<JobDetail>(`/api/jobs/${id}`),
  task: (jobId: string, name: string) => get<TaskDetail>(`/api/jobs/${jobId}/tasks/${name}`),
  taskLog: (jobId: string, name: string, logType: string) => get<{ content: string }>(`/api/jobs/${jobId}/tasks/${name}/logs/${logType}`),
  compare: (ids: string[]) => get<CompareResult>(`/api/compare?ids=${ids.join(",")}`),
};
