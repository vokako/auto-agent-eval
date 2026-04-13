export interface JobSummary {
  id: string;
  config: string;
  timestamp: string;
  agent: string;
  model: string;
  passed: number;
  failed: number;
  errors: number;
  total: number;
  rate: number;
  duration: string;
  finished: boolean;
}

export interface TaskResult {
  name: string;
  passed: boolean;
  reward: number;
  error_type: string | null;
  log_size: number;
}

export interface JobDetail {
  config: string;
  timestamp: string;
  tasks: TaskResult[];
  n_trials: number;
  n_errors: number;
  started_at: string;
  finished_at: string | null;
}

export interface TaskDetail {
  name: string;
  instruction: string;
  agent_log: string;
  verifier_log: string;
  trial_log: string;
}

export interface CompareRow {
  name: string;
  [jobId: string]: { passed: boolean; error_type?: string } | string | null;
}

export interface CompareResult {
  jobs: string[];
  tasks: CompareRow[];
  summary: Record<string, { passed: number; total: number }>;
}
