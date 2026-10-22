import { describe, expect, it } from 'vitest';
import { aiClassifications, buildMappingRequest, proposeAnswers, scanForm } from '../src';
import { htmlPage, sampleProfile } from './helpers';

describe('AI field mapping', () => {
  const doc = htmlPage(`
    <form>
      <label for="a">Email</label><input id="a" type="email">
      <label for="b">Handle on the code hosting site</label><input id="b">
      <label for="c">Are you a veteran?</label><select id="c"><option>Yes</option><option>No</option></select>
      <label for="d">Why do you want this job?</label><textarea id="d"></textarea>
      <label for="e">Upload</label><input id="e" type="file">
    </form>`);
  const scan = scanForm(doc);

  it('sends only the labels of fields the rules left unknown', () => {
    const built = buildMappingRequest(scan.fields);
    expect(built?.request.fields).toEqual([
      {
        id: 'F1',
        label: 'Handle on the code hosting site',
        hint: '',
        section: '',
        control: 'text',
        options: [],
      },
    ]);
    expect(built?.refs).toEqual({ F1: scan.fields[1]?.ref });
    expect(JSON.stringify(built)).not.toContain('Avery');
  });

  it('turns mappings into review-only proposals filled from the profile', () => {
    const built = buildMappingRequest(scan.fields);
    const classifications = aiClassifications(
      [{ fieldId: 'F1', kind: 'link.github', confidence: 'high' }],
      built?.refs ?? {},
    );
    expect(Object.values(classifications)[0]).toMatchObject({ confidence: 'medium', source: 'ai' });
    const proposals = proposeAnswers(scan, {
      profile: sampleProfile(),
      resume: null,
      coverLetter: null,
      aiClassifications: classifications,
    });
    expect(proposals[1]).toMatchObject({
      status: 'review',
      approved: false,
      value: { type: 'text', text: 'https://github.com/avery' },
    });
    // An AI mapping for a field the rules already placed is ignored.
    const wrong = aiClassifications([{ fieldId: 'F1', kind: 'email', confidence: 'high' }], {
      F1: scan.fields[2]?.ref ?? '',
    });
    const again = proposeAnswers(scan, {
      profile: sampleProfile(),
      resume: null,
      coverLetter: null,
      aiClassifications: wrong,
    });
    expect(again[2]).toMatchObject({ status: 'manual', value: null });
  });

  it('returns nothing to send when every field is recognised', () => {
    expect(
      buildMappingRequest(
        scanForm(htmlPage('<form><label for="a">Email</label><input id="a"></form>')).fields,
      ),
    ).toBeNull();
  });
});
