import worker from '../worker.mjs';

// Explicit provider fixture: neither an AI Search emulator nor a managed index.
const SEARCH = {
  async search({ query, ai_search_options: options }) {
    const retrieval = options.retrieval;
    if (this !== SEARCH || retrieval.retrieval_type !== 'keyword' || retrieval.keyword_match_mode !== 'and' ||
        retrieval.context_expansion !== 0 || retrieval.metadata_only !== false || retrieval.return_on_failure !== false ||
        retrieval.match_threshold !== 0 || retrieval.max_num_results !== 5 || options.query_rewrite.enabled !== false ||
        options.reranking.enabled !== false || options.cache.enabled !== false)
      throw new Error('invalid keyword request contract');
    if (query === 'fail') throw new Error('fixture provider failure');
    if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 200));
    if (query === 'empty' || query.length === 4096) return { chunks: [] };
    if (query === 'oversized') return { chunks: [{ id: 'id', type: 'text', score: 0.5,
      text: 'x'.repeat(16385), item: { key: 'doc' } }] };
    return { chunks: [{ id: `id-${query}-猫`, type: query === 'image' ? 'image' : 'text',
      score: query === 'bad-score' ? NaN : 0.75, text: `text-${query}\u0000owned`,
      item: { key: 'docs/猫', metadata: { ignoredDate: new Date(0) } } }] };
  },
};
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, SEARCH }, ctx); } };
