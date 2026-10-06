import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Poll from '../../src/pages/Poll.svelte';
import { POLL_SERVICES } from '../../src/lib/polls/context';
import { FakePollRuntime, FakePollService } from '../helpers/poll-ui';

afterEach(cleanup);
function setup() {
  const api = new FakePollService();
  api.authenticated = true;
  const context = new Map([[POLL_SERVICES, { api, runtime: new FakePollRuntime() }]]);
  render(Poll, { props: { slug: 'topics' }, context });
  return api;
}

it('saves a topic and plain-text description, then hides the fields during editing', async () => {
  const api = setup();
  const description = '<img src=x onerror=alert(1)> **plain text**';
  await fireEvent.input(await screen.findByLabelText('Topic'), {
    target: { value: ' AI gardens ' },
  });
  await fireEvent.input(screen.getByLabelText('Description (optional)'), {
    target: { value: ` ${description} ` },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  await screen.findByText('Your vote is saved.');
  expect(api.submissions[0]).toMatchObject({
    writeIn: 'AI gardens',
    writeInDescription: description,
  });
  await fireEvent.click(await screen.findByRole('button', { name: 'Edit vote' }));
  expect(screen.queryByLabelText('Topic')).toBeNull();
  expect(screen.queryByLabelText('Description (optional)')).toBeNull();
  expect(screen.getByText(description)).toBeTruthy();
  expect(document.querySelector('img[src="x"]')).toBeNull();
  expect(screen.getByRole('radio', { name: /AI gardens/ })).toBeTruthy();
  await fireEvent.click(screen.getByRole('radio', { name: 'Robotics' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('button', { name: 'Edit vote' });
  expect(api.submissions[1]).toMatchObject({ writeIn: null });
  expect(api.submissions[1]?.writeInDescription ?? null).toBeNull();
});

it('hides write-in fields on edits even when the initial vote had no write-in', async () => {
  setup();
  await fireEvent.click(await screen.findByRole('radio', { name: 'Robotics' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Edit vote' }));
  expect(screen.queryByLabelText('Topic')).toBeNull();
  expect(screen.queryByLabelText('Description (optional)')).toBeNull();
  expect(screen.queryByText(/Accepted write-ins become/)).toBeNull();
});

it('requires a topic when a description is entered, without sending a ballot', async () => {
  const api = setup();
  await fireEvent.click(await screen.findByRole('radio', { name: 'Robotics' }));
  await fireEvent.input(screen.getByLabelText('Description (optional)'), {
    target: { value: 'Some details' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  await screen.findByText('Enter a topic for your write-in description.');
  expect(api.submissions).toEqual([]);
});
