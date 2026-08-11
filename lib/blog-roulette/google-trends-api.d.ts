declare module 'google-trends-api' {
  interface InterestOverTimeOptions {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
    granularTimeResolution?: boolean;
  }

  export function interestOverTime(
    options: InterestOverTimeOptions,
  ): Promise<string>;

  const trends: {
    interestOverTime: typeof interestOverTime;
  };
  export default trends;
}
