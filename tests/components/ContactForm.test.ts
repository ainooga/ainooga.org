import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte/svelte5';
import ContactForm from '../../src/components/ContactForm.svelte';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile } from '../../src/lib/turnstile';

describe('ContactForm shared component', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Thanks!' }),
      } as Response),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens on demand and posts to the shared contact endpoint', async () => {
    const fake = new FakeTurnstile();
    render(ContactForm, { context: createTurnstileContext(fake) });

    // Closed CTA state
    expect(document.querySelector('.form-input')).toBeNull();

    const openBtn = document.querySelector('.cta .btn-primary') as HTMLButtonElement;
    await fireEvent.click(openBtn);

    // Form + Turnstile container now present
    expect(document.querySelector('.form-input')).toBeTruthy();

    // Fill and submit
    const nameInput = document.querySelector(
      'input[placeholder="Your name"]',
    ) as HTMLInputElement;
    nameInput.value = 'Alice';
    await fireEvent.input(nameInput);
    const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement;
    phoneInput.value = '555-0123';
    await fireEvent.input(phoneInput);

    const form = document.querySelector('.contact-form') as HTMLFormElement;
    await fireEvent.submit(form);

    // apiPost fires POST /api/contact-sponsor with turnstile token from fake
    await vi.waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });
    const call = vi
      .mocked(globalThis.fetch)
      .mock.calls.find((c) => String(c[0]) === '/api/contact-sponsor');
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1]!.body as string);
    expect(body.name).toBe('Alice');
    expect(body.phone).toBe('555-0123');
    expect(body.turnstileToken).toBe('fake-turnstile-token');
  });

  it('shows a success message after a successful submit', async () => {
    const fake = new FakeTurnstile();
    render(ContactForm, {
      context: createTurnstileContext(fake),
      props: { confirmFootnote: "We'll call you back to set up your membership." },
    });

    await fireEvent.click(
      document.querySelector('.cta .btn-primary') as HTMLButtonElement,
    );
    const nameInput = document.querySelector(
      'input[placeholder="Your name"]',
    ) as HTMLInputElement;
    nameInput.value = 'Alice';
    await fireEvent.input(nameInput);
    const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement;
    phoneInput.value = '555-0123';
    await fireEvent.input(phoneInput);
    await fireEvent.submit(document.querySelector('.contact-form') as HTMLFormElement);

    await waitFor(() => {
      const success = document.querySelector('.form-success');
      expect(success).toBeTruthy();
      expect(success?.textContent).toContain(
        "We'll call you back to set up your membership.",
      );
    });
  });

  it('shows a validation error when phone is missing', async () => {
    const fake = new FakeTurnstile();
    render(ContactForm, { context: createTurnstileContext(fake) });

    await fireEvent.click(
      document.querySelector('.cta .btn-primary') as HTMLButtonElement,
    );
    const nameInput = document.querySelector(
      'input[placeholder="Your name"]',
    ) as HTMLInputElement;
    nameInput.value = 'Alice';
    await fireEvent.input(nameInput);
    await fireEvent.submit(document.querySelector('.contact-form') as HTMLFormElement);

    await waitFor(() => {
      expect(document.querySelector('.error-msg')?.textContent).toContain(
        'Name and phone number required.',
      );
    });
  });

  it('re-renders a fresh Turnstile widget when reopened after closing', async () => {
    const fake = new FakeTurnstile();
    const renderSpy = vi.spyOn(fake, 'render');
    render(ContactForm, { context: createTurnstileContext(fake) });

    await fireEvent.click(
      document.querySelector('.cta .btn-primary') as HTMLButtonElement,
    );
    await waitFor(() => {
      expect(renderSpy).toHaveBeenCalledTimes(1);
    });

    // Close the form
    await fireEvent.click(document.querySelector('.btn-outline') as HTMLButtonElement);
    expect(document.querySelector('.form-input')).toBeNull();

    // Reopen — a fresh widget should render
    await fireEvent.click(
      document.querySelector('.cta .btn-primary') as HTMLButtonElement,
    );
    await waitFor(() => {
      expect(renderSpy).toHaveBeenCalledTimes(2);
      expect(document.querySelector('.form-input')).toBeTruthy();
    });
  });
});
