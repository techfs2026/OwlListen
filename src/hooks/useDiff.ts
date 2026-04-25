import { useMemo } from "react";

export type DiffOp =
  | { type: "ok";   word: string }
  | { type: "del";  word: string }   // 用户多写的（错误）
  | { type: "ins";  word: string };  // 原文有但用户漏掉的（缺失）

export interface DiffResult {
  ops: DiffOp[];
  correct: number;
  wrong: number;   // del
  missing: number; // ins
  accuracy: number; // 0~1
}

/** 把字符串拆成可比较的单词数组（小写 + 去标点） */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}—…\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Myers / LCS diff，返回 edit script */
function lcs(a: string[], b: string[]): DiffOp[] {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const ops: DiffOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: "ok", word: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "ins", word: b[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "del", word: a[i - 1] });
      i--;
    }
  }
  return ops;
}

export function computeDiff(userText: string, refText: string): DiffResult {
  const userWords = tokenize(userText);
  const refWords  = tokenize(refText);
  const ops = lcs(userWords, refWords);

  let correct = 0, wrong = 0, missing = 0;
  for (const op of ops) {
    if (op.type === "ok")  correct++;
    else if (op.type === "del") wrong++;
    else missing++;
  }

  const total = correct + wrong + missing;
  const accuracy = total > 0 ? correct / total : 0;

  return { ops, correct, wrong, missing, accuracy };
}

export function useDiff(userText: string, refText: string): DiffResult {
  return useMemo(
    () => computeDiff(userText, refText),
    [userText, refText]
  );
}