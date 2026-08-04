import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('skills view exposes an explicit cross-pilot skill search action', () => {
  const skillsView = readFileSync(resolve('web/src/components/SkillsView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(skillsView, /const \[skillSearchInput, setSkillSearchInput\] = useState\(''\)/);
  assert.match(skillsView, /type SkillSearchResult = \{/);
  assert.match(skillsView, /const \[skillSearchResult, setSkillSearchResult\] = useState<SkillSearchResult \| null>\(null\)/);
  assert.match(skillsView, /const runSkillSearch = useCallback/);
  assert.match(skillsView, /await searchSkillsAcrossPilots\(q, ctl\.signal\)/);
  assert.match(skillsView, /setSkillSearchResult\(\{ query: q, comparison: null, error: null, loading: true \}\)/);
  assert.doesNotMatch(skillsView, /setTimeout\(async \(\) =>[\s\S]*searchSkillsAcrossPilots/);
  assert.match(skillsView, /<form className="sk-control sk-all-skill-search" onSubmit=\{runSkillSearch\}>/);
  assert.match(skillsView, /placeholder="Skill name\.\.\."/);
  assert.match(skillsView, /type="submit"/);
  assert.match(skillsView, /skillSearchResult\?\.loading \? 'Searching\.\.\.' : 'Search'/);
  assert.match(skillsView, /<div className="sk-search-results-row">[\s\S]*?<SkillComparisonPanel/);
  assert.match(styles, /\.sk-all-skill-search \{[\s\S]*?display: grid;/);
  assert.match(styles, /\.sk-skill-search-row \{[\s\S]*?grid-template-columns: minmax\(180px, 1fr\) auto;/);
  assert.match(styles, /\.sk-search-results-row \{[\s\S]*?grid-column: 1 \/ -1;/);
});
