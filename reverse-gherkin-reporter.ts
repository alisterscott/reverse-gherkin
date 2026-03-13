import fs from 'node:fs';
import path from 'node:path';
import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

type StepStatus = 'passed' | 'failed';

type CapturedStep = {
  title: string;
  status: StepStatus;
};

type CapturedAnnotation = {
  type: string;
  description?: string;
};

type CapturedTest = {
  feature: string;
  testTitle: string;
  project: string;
  status: TestResult['status'];
  tags: string[];
  annotations: CapturedAnnotation[];
  steps: CapturedStep[];
};

type ReverseGherkinReporterOptions = {
  outputFile?: string;
  includeAnnotations?: boolean;
};

class ReverseGherkinReporter implements Reporter {
  private outputFile: string;
  private includeAnnotations: boolean;
  private testAttempts = new Map<string, CapturedStep[]>();
  private finalTests: CapturedTest[] = [];
  private featureOrder: string[] = [];
  private featureSet = new Set<string>();

  constructor(options: ReverseGherkinReporterOptions = {}) {
    this.outputFile =
      options.outputFile || path.join('test-results', 'reverse-gherkin.md');
    this.includeAnnotations = options.includeAnnotations ?? true;
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    const attemptKey = this.getAttemptKey(test, result);
    this.testAttempts.set(attemptKey, []);
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    // Capture only explicit user steps created with test.step(...)
    if (step.category !== 'test.step') {
      return;
    }

    const attemptKey = this.getAttemptKey(test, result);
    const steps = this.testAttempts.get(attemptKey) || [];
    steps.push({
      title: step.title,
      status: step.error ? 'failed' : 'passed',
    });
    this.testAttempts.set(attemptKey, steps);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const attemptKey = this.getAttemptKey(test, result);
    const feature = this.getFeatureTitle(test);
    const project = this.getProjectName(test);
    const titleTags = this.getTitleTags(test.title);
    const mergedTags = [...new Set([...test.tags, ...titleTags])];

    if (!this.featureSet.has(feature)) {
      this.featureSet.add(feature);
      this.featureOrder.push(feature);
    }

    this.finalTests.push({
      feature,
      testTitle: this.getDisplayTestTitle(test.title),
      project,
      status: result.status,
      tags: mergedTags,
      annotations: test.annotations,
      steps: this.testAttempts.get(attemptKey) || [],
    });
  }

  async onEnd(): Promise<void> {
    const featureToTests = new Map<string, CapturedTest[]>();

    for (const testData of this.finalTests) {
      if (!featureToTests.has(testData.feature)) {
        featureToTests.set(testData.feature, []);
      }
      featureToTests.get(testData.feature)?.push(testData);
    }

    const lines: string[] = [];
    lines.push('# Reverse Gherkin Test Results 🥒');
    lines.push('');

    for (const feature of this.featureOrder) {
      const tests = featureToTests.get(feature) || [];
      if (tests.length === 0) {
        continue;
      }

      lines.push(`# ${feature}`);
      lines.push('');

      for (const testData of tests) {
        const testEmoji = this.getTestEmoji(testData.status);
        const testTitle = this.includeAnnotations
          ? `## ${testData.testTitle} ${testEmoji}`
          : `## ${testData.testTitle} ${testEmoji} \`${testData.project}\``;
        lines.push(testTitle);
        lines.push('');

        if (this.includeAnnotations) {
          this.appendMetadataTable(lines, testData);
          lines.push('');
        }

        lines.push('```text');

        if (testData.steps.length === 0) {
          lines.push('(No test steps recorded)');
        } else {
          for (const step of testData.steps) {
            const stepEmoji = this.getStepEmoji(step.status);
            lines.push(`${step.title} ${stepEmoji}`);
          }
        }

        lines.push('```');
        lines.push('');
      }
    }

    const outputPath = path.resolve(this.outputFile);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  }

  private appendMetadataTable(lines: string[], testData: CapturedTest): void {
    const rows: Array<{ key: string; value: string }> = [];
    rows.push({ key: 'Project', value: `\`${testData.project}\`` });

    if (testData.tags.length > 0) {
      rows.push({
        key: '**Tags**',
        value: testData.tags.map((tag) => `\`${tag}\``).join(' '),
      });
    }

    for (const annotation of testData.annotations) {
      rows.push({
        key: `**${annotation.type}**`,
        value: annotation.description || '',
      });
    }

    if (rows.length === 0) {
      return;
    }

    lines.push(`| ${rows[0].key} | ${rows[0].value} |`);
    lines.push('| --------------- | ----------------------- |');
    for (let i = 1; i < rows.length; i += 1) {
      lines.push(`| ${rows[i].key} | ${rows[i].value} |`);
    }
  }

  private getProjectName(test: TestCase): string {
    let current: Suite | undefined = test.parent;
    while (current) {
      const project = current.project();
      if (project) {
        return project.name;
      }
      current = current.parent;
    }
    return 'unknown';
  }

  private getAttemptKey(test: TestCase, result: TestResult): string {
    const project = this.getProjectName(test);
    return `${project}::${test.id}#${result.retry}`;
  }

  private getTitleTags(title: string): string[] {
    const tags = title.match(/@[A-Za-z0-9:_-]+/g) || [];
    return [...new Set(tags)];
  }

  private getDisplayTestTitle(title: string): string {
    const titleTags = this.getTitleTags(title);
    let cleanedTitle = title;

    for (const tag of titleTags) {
      cleanedTitle = cleanedTitle.replace(
        new RegExp(`(^|\\s)${this.escapeRegExp(tag)}(?=\\s|$)`, 'g'),
        ' '
      );
    }

    cleanedTitle = cleanedTitle.replace(/\s+/g, ' ').trim();
    return cleanedTitle || title;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getFeatureTitle(test: TestCase): string {
    const describeTitles: string[] = [];
    let current: Suite | undefined = test.parent;

    while (current) {
      if (current.type === 'describe' && current.title) {
        describeTitles.unshift(current.title);
      }
      current = current.parent;
    }

    if (describeTitles.length === 0) {
      return 'Unnamed Feature';
    }

    return describeTitles.join(' / ');
  }

  private getTestEmoji(status: TestResult['status']): string {
    if (status === 'passed') {
      return '✅';
    }

    if (
      status === 'failed' ||
      status === 'timedOut' ||
      status === 'interrupted'
    ) {
      return '❌';
    }

    if (status === 'skipped') {
      return '⏭️';
    }

    return '❔';
  }

  private getStepEmoji(status: StepStatus): string {
    return status === 'passed' ? '✅' : '❌';
  }
}

export default ReverseGherkinReporter;
