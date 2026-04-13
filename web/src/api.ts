import type { JobSummary, JobDetail, TaskDetail, CompareResult } from "./types";

const BASE = import.meta.env.DEV ? "http://localhost:8080" : "";

export async function fetchJobs(): Promise<JobSummary[]> {
  const res = await fetch(`${BASE}/api/jobs`);
  return res.json();
}

export async function fetchJob(id: string): Promise<JobDetail> {
  const res = await fetch(`${BASE}/api/jobs/${id}`);
  return res.json();
}

export async function fetchTask(jobId: string, taskName: string): Promise<TaskDetail> {
  const res = await fetch(`${BASE}/api/jobs/${jobId}/tasks/${taskName}`);
  return res.json();
}

export async function fetchCompare(ids: string[]): Promise<CompareResult> {
  const res = await fetch(`${BASE}/api/compare?ids=${ids.join(",")}`);
  return res.json();
}
