import { describe, it, expect } from 'vitest';
import {
  ProductFrontmatter,
  MemberFrontmatter,
  type ProductFrontmatterType,
  type MemberFrontmatterType,
} from '../../scripts/types';

describe('ProductFrontmatter', () => {
  it('validates a membership tier', () => {
    const raw = {
      name: 'Pro',
      family: 'membership',
      price: '$300 / year',
      frequency: 'annual',
      order: 2,
      featured: true,
      benefits: ['Everything in Basic', 'Directory listing'],
      status: 'published',
    };
    const result = ProductFrontmatter.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('validates an advertising product with a period-earmark framing', () => {
    const raw = {
      name: 'Slide placement',
      family: 'advertising',
      price: 'Quote by period',
      frequency: 'period earmark',
      order: 0,
      benefits: ['Logo or message in the deck rotation'],
      status: 'published',
    };
    const result = ProductFrontmatter.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown family', () => {
    const result = ProductFrontmatter.safeParse({
      name: 'X',
      family: 'sponsorship',
      status: 'published',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict schema)', () => {
    const result = ProductFrontmatter.safeParse({
      name: 'X',
      family: 'membership',
      status: 'published',
      surprise: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('requires a name and status (no silent defaults)', () => {
    const noName = ProductFrontmatter.safeParse({ family: 'membership' });
    expect(noName.success).toBe(false);
    const noStatus = ProductFrontmatter.safeParse({
      name: 'Basic',
      family: 'membership',
    });
    expect(noStatus.success).toBe(false);
  });

  it('surfaces the family on the validated output', () => {
    const result = ProductFrontmatter.safeParse({
      name: 'Pro Plus',
      family: 'advertising',
      status: 'published',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const product = result.data as ProductFrontmatterType;
      expect(product.family).toBe('advertising');
    }
  });
});

describe('MemberFrontmatter directory fields', () => {
  it('validates a listed member with services and rank', () => {
    const raw = {
      name: 'John Gardner',
      role: 'Lead Director',
      listed: true,
      organizer: true,
      rank: 'Founder / Lead Organizer',
      services: ['AI strategy', 'Engineering leadership'],
      tags: ['organizer'],
      status: 'active',
    };
    const result = MemberFrontmatter.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const member = result.data as MemberFrontmatterType;
      expect(member.listed).toBe(true);
      expect(member.organizer).toBe(true);
      expect(member.services).toHaveLength(2);
      expect(member.rank).toBe('Founder / Lead Organizer');
    }
  });

  it('allows a member who is not listed (opt-in gate) with no directory fields', () => {
    const raw = {
      name: 'Anonymous Member',
      status: 'active',
    };
    const result = MemberFrontmatter.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const member = result.data as MemberFrontmatterType;
      expect(member.listed).toBeUndefined();
      expect(member.services).toBeUndefined();
      expect(member.rank).toBeUndefined();
    }
  });

  it('rejects a non-boolean listed value', () => {
    const result = MemberFrontmatter.safeParse({
      name: 'X',
      listed: 'yes',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('rejects services that are not an array of strings', () => {
    const result = MemberFrontmatter.safeParse({
      name: 'X',
      services: ['ok', 42],
      status: 'active',
    });
    expect(result.success).toBe(false);
  });
});
