declare module 'turndown' {
  class TurndownService {
    constructor(options?: {
      headingStyle?: 'setext' | 'atx';
      hr?: string;
      br?: string;
      linkStyle?: 'inlined' | 'referenced';
      linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
      imageSizeStyle?: 'width' | 'height' | 'none';
      strongDelimiter?: '**' | '__';
      emDelimiter?: '*' | '_';
      codeBlockStyle?: 'indented' | 'fenced';
      fence?: '```' | '~~~';
      bullet?: '*' | '-' | '+';
      keepReplacement?: (content: string, node: any) => string;
      blankReplacement?: (content: string, node: any) => string;
      defaultReplacement?: (content: string, node: any) => string;
    });

    use(plugin: any | any[]): this;
    turndown(html: string): string;
  }

  export default TurndownService;
}

declare module 'turndown-plugin-gfm' {
  export const gfm: any;
  export const tables: any;
  export const strikethrough: any;
  export const taskListItems: any;
}
