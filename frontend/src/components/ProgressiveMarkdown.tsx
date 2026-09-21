import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
const parser = unified().use(remarkParse).use(remarkGfm);
const Block = memo(function Block({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={plugins}>{text}</ReactMarkdown>;
});

/** Parse snapshot boundaries once; only the unfinished block changes while typing. */
export default function ProgressiveMarkdown({ markdown, visibleLength }: { markdown: string; visibleLength: number }) {
  const { blocks, definitions } = useMemo(() => {
    const nodes = parser.parse(markdown).children;
    return {
      blocks: nodes.filter(node => node.type !== "definition").map(node => ({
        start: node.position?.start.offset ?? 0,
        end: node.position?.end.offset ?? markdown.length,
      })),
      definitions: nodes.filter(node => node.type === "definition").map(node =>
        markdown.slice(node.position?.start.offset, node.position?.end.offset)).join("\n"),
    };
  }, [markdown]);
  return <>{blocks.filter(block => block.start < visibleLength).map(block => (
    <Block key={block.start} text={markdown.slice(block.start, Math.min(block.end, visibleLength)) + (definitions ? `\n\n${definitions}` : "")} />
  ))}</>;
}
