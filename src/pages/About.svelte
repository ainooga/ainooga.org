<script lang="ts">
</script>

<div class="container about-page">
  <p class="section__label" style="padding-top: var(--space-3xl)">About</p>
  <h1 class="page-title">AI Nooga</h1>
  <p class="about__intro">
    Chattanooga's AI club — education, policy, research, networking. We meet in person.
  </p>

  <hr class="divider" />

  <section class="about-section">
    <p class="section__label">Mission</p>
    <h2 class="about__heading">Making Chattanooga a hub for thoughtful AI</h2>
    <p class="about__text">
      AI Nooga brings together people who want to understand AI deeply, shape how it's governed,
      and build real relationships with the people doing the work. We're a club — not a company,
      not a consultancy, not a conference series.
    </p>
  </section>

  <hr class="divider" />

  <section class="about-section">
    <p class="section__label">Pillars</p>
    <h2 class="about__heading">What we do</h2>
    <div class="pillar-grid">
      <div class="pillar">
        <h3 class="pillar__title">Education</h3>
        <p class="pillar__text">
          Hands-on workshops, study groups, and technical deep-dives. We demystify AI
          for all skill levels — from curious beginners to experienced practitioners.
        </p>
      </div>
      <div class="pillar">
        <h3 class="pillar__title">Policy</h3>
        <p class="pillar__text">
          AI policy is being written now. We engage with local and state government,
          host policy salons, and write position papers to ensure thoughtful governance.
        </p>
      </div>
      <div class="pillar">
        <h3 class="pillar__title">Research</h3>
        <p class="pillar__text">
          Collaborative projects, journal clubs, and connections between academic researchers
          and industry practitioners. We learn by doing and sharing.
        </p>
      </div>
      <div class="pillar">
        <h3 class="pillar__title">Networking</h3>
        <p class="pillar__text">
          Socials, mixers, and mentorship pairings. AI is a team sport, and the best insights
          happen face to face, over coffee or a whiteboard.
        </p>
      </div>
    </div>
  </section>

  <hr class="divider" />

  <section class="about-section">
    <p class="section__label">Face to face</p>
    <h2 class="about__heading">Real connection, in real rooms</h2>
    <p class="about__text">
      AI Nooga is fundamentally an in-real-life club. The website exists to get you to events,
      conversations, and relationships. We meet in Chattanooga — in rooms where you can see
      the whites of someone's eyes while you argue about attention mechanisms.
    </p>
  </section>

  <hr class="divider" />

  <section class="about-section">
    <p class="section__label">Chattanooga</p>
    <h2 class="about__heading">Gig City, Scenic City</h2>
    <p class="about__text">
      Chattanooga has gigabit fiber, a thriving innovation district around The Enterprise Center,
      world-class research nearby, and a culture that values doing things together in person.
      AI Nooga is part of that story.
    </p>
  </section>

  <hr class="divider" />

  <section class="about-section" style="text-align: center; padding: var(--space-3xl) 0 var(--space-4xl)">
    <h2 class="about__heading">Join us</h2>
    <p class="about__text" style="max-width: 480px; margin: 0 auto var(--space-lg)">
      Come to an event. Bring a friend. Bring a question. That's how a club works.
    </p>
    <a href="#/events" class="btn btn-primary">View events</a>
  </section>
</div>

<style>
  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    font-weight: 400;
    margin: var(--space-sm) 0 var(--space-lg);
  }

  .about-page {
    padding-bottom: var(--space-4xl);
  }

  .about__intro {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 600px;
  }

  .about-section {
    padding: var(--space-2xl) 0;
  }

  .about__heading {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: 400;
    margin-bottom: var(--space-md);
  }

  .about__text {
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .pillar-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-xl);
    margin-top: var(--space-lg);
  }

  .pillar__title {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 600;
    margin-bottom: var(--space-sm);
  }

  .pillar__text {
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  @media (max-width: 768px) {
    .pillar-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
