/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * @typedef {import("./@types/ExperimentManager").RecipeArgs} RecipeArgs
 * @typedef {import("./@types/ExperimentManager").Enrollment} Enrollment
 * @typedef {import("./@types/ExperimentManager").Branch} Branch
 */

const EXPORTED_SYMBOLS = ["ExperimentManager", "_ExperimentManager"];

const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  ClientEnvironment: "resource://normandy/lib/ClientEnvironment.jsm",
  ExperimentStore:
    "resource://messaging-system/experiments/ExperimentStore.jsm",
  NormandyUtils: "resource://normandy/lib/NormandyUtils.jsm",
  Sampling: "resource://gre/modules/components-utils/Sampling.jsm",
  TelemetryEvents: "resource://normandy/lib/TelemetryEvents.jsm",
  TelemetryEnvironment: "resource://gre/modules/TelemetryEnvironment.jsm",
  RemoteSettings: "resource://services-settings/remote-settings.js",
  requestIdleCallback: "resource://gre/modules/Timer.jsm",
  ASRouterTargeting: "resource://activity-stream/lib/ASRouterTargeting.jsm",
});

XPCOMUtils.defineLazyGetter(this, "log", () => {
  const { Logger } = ChromeUtils.import(
    "resource://messaging-system/lib/Logger.jsm"
  );
  return new Logger("ExperimentManager");
});

// This is included with event telemetry e.g. "enroll"
// TODO: Add a new type called "messaging_study"
const EVENT_TELEMETRY_STUDY_TYPE = "preference_study";
// This is used by Telemetry.setExperimentActive
const TELEMETRY_EXPERIMENT_TYPE_PREFIX = "normandy-";
// Also included in telemetry
const DEFAULT_EXPERIMENT_TYPE = "messaging_experiment";

// Experiment groups that are currently collecting the Reach events.
//
// If you're adding new groups to it, make sure they're also added in the
// `messaging_experiments.reach.objects` defined in "toolkit/components/telemetry/Events.yaml"
//
// Note: although Events telemetry only takes "_", you can still have "-"(s) in
// the group names here. They will be automatically swapped whenever needed.
const REACH_EVENT_GROUPS = ["cfr"];
const REACH_EVENT_CATEGORY = "messaging_experiments";
const REACH_EVENT_METHOD = "reach";

// Experiment recipe collection ID on RemoteSettings
const COLLECTION_ID = "messaging-experiments";

/**
 * A module for processes Experiment recipes, choosing and storing enrollment state,
 * and sending experiment-related Telemetry.
 */
class _ExperimentManager {
  constructor({ id = "experimentmanager", store } = {}) {
    this.id = id;
    this.store = store || new ExperimentStore();
    this.sessions = new Map();

    this.filterContext = {};
    Object.defineProperty(this.filterContext, "activeExperiments", {
      get: async () => {
        await this.store.ready();
        return this.store.getAllActive().map(exp => exp.slug);
      },
    });
  }

  /**
   * Runs on startup, including before first run
   */
  async onStartup() {
    await this.store.init();
    const restoredExperiments = this.store.getAllActive();

    for (const experiment of restoredExperiments) {
      this.setExperimentActive(experiment);
    }
  }

  /**
   * Runs every time a Recipe is updated or seen for the first time.
   * @param {RecipeArgs} recipe
   * @param {string} source
   */
  async onRecipe(recipe, source) {
    const { slug, isEnrollmentPaused } = recipe;

    if (!source) {
      throw new Error("When calling onRecipe, you must specify a source.");
    }

    if (!this.sessions.has(source)) {
      this.sessions.set(source, new Set());
    }
    this.sessions.get(source).add(slug);

    if (this.store.has(slug)) {
      this.updateEnrollment(recipe);
    } else if (isEnrollmentPaused) {
      log.debug(`Enrollment is paused for "${slug}"`);
    } else {
      await this.enroll(recipe, source);
    }
  }

  /**
   * Runs when the all recipes been processed during an update, including at first run.
   * @param {string} sourceToCheck
   */
  onFinalize(sourceToCheck) {
    if (!sourceToCheck) {
      throw new Error("When calling onFinalize, you must specify a source.");
    }
    const activeExperiments = this.store.getAllActive();

    for (const experiment of activeExperiments) {
      const { slug, source } = experiment;
      if (sourceToCheck !== source) {
        continue;
      }
      if (!this.sessions.get(source)?.has(slug)) {
        log.debug(`Stopping study for recipe ${slug}`);
        try {
          this.unenroll(slug, "recipe-not-seen");
        } catch (err) {
          Cu.reportError(err);
        }
      }
    }

    if (activeExperiments.length) {
      requestIdleCallback(() => this.sendReachEvents());
    }

    this.sessions.delete(sourceToCheck);
  }

  /**
   * Start a new experiment by enrolling the users
   *
   * @param {RecipeArgs} recipe
   * @param {string} source
   * @returns {Promise<Enrollment>} The experiment object stored in the data store
   * @rejects {Error}
   * @memberof _ExperimentManager
   */
  async enroll(
    { slug, branches, experimentType = DEFAULT_EXPERIMENT_TYPE },
    source
  ) {
    if (this.store.has(slug)) {
      this.sendFailureTelemetry("enrollFailed", slug, "name-conflict");
      throw new Error(`An experiment with the slug "${slug}" already exists.`);
    }

    const enrollmentId = NormandyUtils.generateUuid();
    const branch = await this.chooseBranch(slug, branches);

    if (branch.groups && this.store.hasExperimentForGroups(branch.groups)) {
      log.debug(
        `Skipping enrollment for "${slug}" because there is an existing experiment for one of its groups.`
      );
      this.sendFailureTelemetry("enrollFailed", slug, "group-conflict");
      throw new Error(`An experiment with a conflicting group already exists.`);
    }

    /** @type {Enrollment} */
    const experiment = {
      slug,
      branch,
      active: true,
      enrollmentId,
      experimentType,
      source,
    };

    this.store.addExperiment(experiment);
    this.setExperimentActive(experiment);
    this.sendEnrollmentTelemetry(experiment);

    log.debug(`New experiment started: ${slug}, ${branch.slug}`);

    return experiment;
  }

  /**
   * Update an enrollment that was already set
   *
   * @param {RecipeArgs} recipe
   */
  updateEnrollment(recipe) {
    /** @type Enrollment */
    const experiment = this.store.get(recipe.slug);

    // Don't update experiments that were already unenrolled.
    if (experiment.active === false) {
      log.debug(`Enrollment ${recipe.slug} has expired, aborting.`);
      return;
    }

    // Stay in the same branch, don't re-sample every time.
    const branch = recipe.branches.find(
      branch => branch.slug === experiment.branch.slug
    );

    if (!branch) {
      // Our branch has been removed. Unenroll.
      this.unenroll(recipe.slug, "branch-removed");
    }
  }

  /**
   * Stop an experiment that is currently active
   *
   * @param {string} slug
   * @param {string} reason
   */
  unenroll(slug, reason = "unknown") {
    const experiment = this.store.get(slug);
    if (!experiment) {
      this.sendFailureTelemetry("unenrollFailed", slug, "does-not-exist");
      throw new Error(`Could not find an experiment with the slug "${slug}"`);
    }

    if (!experiment.active) {
      this.sendFailureTelemetry("unenrollFailed", slug, "already-unenrolled");
      throw new Error(
        `Cannot stop experiment "${slug}" because it is already expired`
      );
    }

    this.store.updateExperiment(slug, { active: false });

    TelemetryEnvironment.setExperimentInactive(slug);
    TelemetryEvents.sendEvent("unenroll", EVENT_TELEMETRY_STUDY_TYPE, slug, {
      reason,
      branch: experiment.branch.slug,
      enrollmentId:
        experiment.enrollmentId || TelemetryEvents.NO_ENROLLMENT_ID_MARKER,
    });

    log.debug(`Experiment unenrolled: ${slug}}`);
  }

  /**
   * Send Telemetry for undesired event
   *
   * @param {string} eventName
   * @param {string} slug
   * @param {string} reason
   */
  sendFailureTelemetry(eventName, slug, reason) {
    TelemetryEvents.sendEvent(eventName, EVENT_TELEMETRY_STUDY_TYPE, slug, {
      reason,
    });
  }

  /**
   *
   * @param {Enrollment} experiment
   */
  sendEnrollmentTelemetry({ slug, branch, experimentType, enrollmentId }) {
    TelemetryEvents.sendEvent("enroll", EVENT_TELEMETRY_STUDY_TYPE, slug, {
      experimentType,
      branch: branch.slug,
      enrollmentId: enrollmentId || TelemetryEvents.NO_ENROLLMENT_ID_MARKER,
    });
  }

  /**
   * Sets Telemetry when activating an experiment.
   *
   * @param {Enrollment} experiment
   * @memberof _ExperimentManager
   */
  setExperimentActive(experiment) {
    TelemetryEnvironment.setExperimentActive(
      experiment.slug,
      experiment.branch.slug,
      {
        type: `${TELEMETRY_EXPERIMENT_TYPE_PREFIX}${experiment.experimentType}`,
        enrollmentId:
          experiment.enrollmentId || TelemetryEvents.NO_ENROLLMENT_ID_MARKER,
      }
    );
  }

  /**
   * Choose a branch randomly.
   *
   * @param {string} slug
   * @param {Branch[]} branches
   * @returns {Promise<Branch>}
   * @memberof _ExperimentManager
   */
  async chooseBranch(slug, branches) {
    const ratios = branches.map(({ ratio = 1 }) => ratio);
    const userId = ClientEnvironment.userId;

    // It's important that the input be:
    // - Unique per-user (no one is bucketed alike)
    // - Unique per-experiment (bucketing differs across multiple experiments)
    // - Differs from the input used for sampling the recipe (otherwise only
    //   branches that contain the same buckets as the recipe sampling will
    //   receive users)
    const input = `${this.id}-${userId}-${slug}-branch`;

    const index = await Sampling.ratioSample(input, ratios);
    return branches[index];
  }

  /**
   * Sends Reach events for active experiments
   *
   * Note:
   *
   * * To avoid interrupting the enrollment process, this is done in a browser
   *   idle callback other than in `this.onRecipe()` or `this.enroll()`
   *
   * @param {RemoteSettings} remoteSettingsClient for test only
   *
   */
  async sendReachEvents(remoteSettingsClient) {
    let recipes;

    for (const group of REACH_EVENT_GROUPS) {
      const experiment = this.store.getExperimentForGroup(group);
      if (!experiment) {
        log.debug("Skipping sending Reach events for no active experiment");
        continue;
      }

      // Need recipes for the branches information. Note that it defers the
      // RemoteSettings call until seeing the first active experiment that
      // might record a reach event.
      if (!recipes) {
        try {
          const client = remoteSettingsClient || RemoteSettings(COLLECTION_ID);
          // Do not sync if it's empty, let RemoteSettingsExperimentLoader do that
          recipes = await client.get({ syncIfEmpty: false });
        } catch (e) {
          log.debug(
            "Reach events not recorded, error getting recipes from remote settings"
          );
          return;
        }
      }

      const recipe = recipes.find(
        recipe => recipe.arguments.slug === experiment.slug
      );
      if (!recipe) {
        log.debug(
          "Can't find experiment recipe, skipping sending Reach events"
        );
        continue;
      }

      // Check targeting for every branch, and only record those qualified ones
      let qualifiedBranches = [];
      for (const branch of recipe.arguments.branches) {
        if (
          branch.value?.content?.targeting &&
          Boolean(
            await ASRouterTargeting.isMatch(
              branch.value.content.targeting,
              this.filterContext,
              err => {
                log.debug("Targeting failed because of an error");
                Cu.reportError(err);
              }
            )
          )
        ) {
          qualifiedBranches.push(branch.slug);
        }
      }

      if (qualifiedBranches.length) {
        // Events telemetry only takes underscore
        const underscored = group.split("-").join("_");
        const extra = { branches: qualifiedBranches.join(";") };
        Services.telemetry.recordEvent(
          REACH_EVENT_CATEGORY,
          REACH_EVENT_METHOD,
          underscored,
          experiment.slug,
          extra
        );
      }
    }
  }
}

const ExperimentManager = new _ExperimentManager();
