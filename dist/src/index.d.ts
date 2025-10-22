import { AuditResult } from './types.js';
import { Sev } from './utils/helpers.js';
/** Finding/Category shapes used downstream */
export type Finding = {
    id: string;
    title: string;
    message?: string;
    suggestion?: string;
    severity: Sev;
    status?: 'pass' | 'fail';
    file?: string;
    artifacts?: string[];
};
export type Category = {
    id: string;
    title: string;
    findings: Finding[];
    score?: number;
    _maxPoints?: number;
};
/** CLI options */
export type RunOptions = {
    outDir?: string;
    writeHtml?: boolean;
    writeJson?: boolean;
};
/** Programmatic API */
export declare function runAudit(targetDir: string, options?: RunOptions): Promise<AuditResult>;
