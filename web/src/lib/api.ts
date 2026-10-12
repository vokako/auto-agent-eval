import type { JobSummary, JobDetail, TaskDetail, CompareResult } from "../types";

// Same-origin in production; in `npm run dev` Vite proxies /api to the backend (see vite.config.ts).
export const BASE = "";

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
  effortCurves: () => get<EffortCurves>("/api/effort-curves"),
};

export interface EffortPoint { effort: string; job: string; tasks: number; passed: number; cost_usd: number; credits: number; agent_s: number }
export interface EffortSeries { agent: string; model: string; version: string; points: EffortPoint[] }
export interface EffortCurves { efforts: string[]; series: EffortSeries[] }
