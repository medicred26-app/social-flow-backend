import { supabase } from '../shared/utils/supabase.js';
import { MARKETPLACE_CONFIG } from './marketplace.config.js';

// Helper for resilient Supabase queries with 1.5s timeout
async function withTimeout(promise, ms = 1500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), ms))
  ]);
}

// In-memory persistent state (fallback if Supabase tables not yet migrated)
const memoryStore = {
  settings: {
    commission_percentage: MARKETPLACE_CONFIG.defaultCommissionPercentage
  },
  categories: [...MARKETPLACE_CONFIG.categories],
  freelancers: [],
  services: [],
  portfolio: [],
  jobs: [],
  reviews: [],
  payments: [],
  proposals: []
};

// 1. Commission / Settings Helpers
export async function getCommissionPercentage() {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('setting_value')
        .eq('setting_key', 'commission_rate')
        .maybeSingle();

      if (!error && data?.setting_value?.percentage !== undefined) {
        return Number(data.setting_value.percentage);
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Using memory fallback for commission rate:', err.message);
  }
  return memoryStore.settings.commission_percentage;
}

export async function setCommissionPercentage(percentage) {
  const rate = Math.max(0, Math.min(50, Number(percentage)));
  memoryStore.settings.commission_percentage = rate;

  try {
    if (supabase) {
      await supabase.from('platform_settings').upsert({
        setting_key: 'commission_rate',
        setting_value: { percentage: rate },
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' });
    }
  } catch (err) {
    console.warn('[Marketplace DB] Could not sync commission rate to Supabase:', err.message);
  }
  return rate;
}

// 2. Categories Helpers
export async function getCategories() {
  try {
    if (supabase) {
      const { data, error } = await withTimeout(supabase.from('marketplace_categories').select('*').order('name'));
      if (!error && data && data.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Using memory store categories:', err.message);
  }
  return memoryStore.categories;
}

// 3. Freelancers Helpers
export async function getApprovedFreelancers(filters = {}) {
  const { category, search, availability, minRating } = filters;

  try {
    if (supabase) {
      let query = supabase
        .from('freelancer_profiles')
        .select('*')
        .eq('verification_status', 'approved');

      if (availability) query = query.eq('availability_status', availability);

      const { data, error } = await withTimeout(query);
      if (!error && data) {
        let results = data;
        if (category) {
          results = results.filter(f => f.categories?.includes(category));
        }
        if (search) {
          const s = search.toLowerCase();
          results = results.filter(f => 
            f.professional_title?.toLowerCase().includes(s) || 
            f.user_name?.toLowerCase().includes(s) ||
            f.bio?.toLowerCase().includes(s) ||
            f.skills?.some(sk => sk.toLowerCase().includes(s))
          );
        }
        if (minRating) {
          results = results.filter(f => Number(f.rating_avg) >= Number(minRating));
        }
        return results;
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Using memory store for freelancers:', err.message);
  }

  let results = memoryStore.freelancers.filter(f => f.verification_status === 'approved');
  if (category) results = results.filter(f => f.categories?.includes(category));
  if (search) {
    const s = search.toLowerCase();
    results = results.filter(f => 
      f.professional_title?.toLowerCase().includes(s) || 
      f.user_name?.toLowerCase().includes(s) ||
      f.bio?.toLowerCase().includes(s) ||
      f.skills?.some(sk => sk.toLowerCase().includes(s))
    );
  }
  if (availability) results = results.filter(f => f.availability_status === availability);
  if (minRating) results = results.filter(f => Number(f.rating_avg) >= Number(minRating));

  return results;
}

export async function getFreelancerById(id) {
  try {
    if (supabase) {
      const { data, error } = await withTimeout(
        supabase
          .from('freelancer_profiles')
          .select('*')
          .eq('id', id)
          .maybeSingle()
      );

      if (!error && data) return data;
    }
  } catch (err) {
    console.warn('[Marketplace DB] Using memory freelancer lookup:', err.message);
  }
  return memoryStore.freelancers.find(f => f.id === id || f.user_id === id) || null;
}

export async function getFreelancerByUserId(userId) {
  try {
    if (supabase) {
      const { data, error } = await withTimeout(
        supabase
          .from('freelancer_profiles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
      );

      if (!error && data) return data;
    }
  } catch (err) {
    console.warn('[Marketplace DB] Using memory user_id freelancer lookup:', err.message);
  }
  return memoryStore.freelancers.find(f => f.user_id === userId) || null;
}

export async function saveFreelancerApplication(profileData) {
  const baseProfile = {
    user_id: profileData.user_id,
    user_email: profileData.user_email,
    user_name: profileData.user_name || profileData.user_email.split('@')[0],
    user_avatar: profileData.user_avatar || '',
    professional_title: profileData.professional_title,
    bio: profileData.bio,
    skills: profileData.skills || [],
    categories: profileData.categories || [],
    experience_years: profileData.experience_years || 1,
    hourly_rate: profileData.hourly_rate || 0,
    availability_status: 'available',
    verification_status: 'approved', // Auto-approved immediately (no admin required)
    rating_avg: 5.0,
    completed_jobs_count: 0,
    updated_at: new Date().toISOString()
  };

  // Supabase upsert (by user_id)
  try {
    if (supabase) {
      // Also update role in users table
      try {
        await supabase
          .from('users')
          .update({ role: 'freelancer' })
          .eq('id', baseProfile.user_id);
      } catch (_) {}

      const { data: existing } = await supabase
        .from('freelancer_profiles')
        .select('id, verification_status')
        .eq('user_id', baseProfile.user_id)
        .maybeSingle();

      if (existing) {
        const updatePayload = { ...baseProfile, verification_status: 'approved' };
        const { data, error } = await supabase
          .from('freelancer_profiles')
          .update(updatePayload)
          .eq('id', existing.id)
          .select()
          .single();
        if (!error && data) {
          const idx = memoryStore.freelancers.findIndex(f => f.user_id === baseProfile.user_id);
          if (idx >= 0) memoryStore.freelancers[idx] = data;
          else memoryStore.freelancers.push(data);
          return data;
        }
        if (error) console.warn('[Marketplace DB] Supabase freelancer update error:', error.message);
      } else {
        const { data, error } = await supabase
          .from('freelancer_profiles')
          .insert({ ...baseProfile, created_at: new Date().toISOString() })
          .select()
          .single();
        if (!error && data) {
          memoryStore.freelancers.push(data);
          return data;
        }
        if (error) console.warn('[Marketplace DB] Supabase freelancer insert error:', error.message);
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Supabase freelancer save fallback:', err.message);
  }

  const idx = memoryStore.freelancers.findIndex(f => f.user_id === baseProfile.user_id);
  if (idx >= 0) {
    memoryStore.freelancers[idx] = { ...memoryStore.freelancers[idx], ...baseProfile };
    return memoryStore.freelancers[idx];
  }
  const newProfile = { id: `fl_${Date.now()}`, ...baseProfile, created_at: new Date().toISOString() };
  memoryStore.freelancers.push(newProfile);
  return newProfile;
}

export async function updateFreelancersVerification(id, status, reason = '') {
  const fl = memoryStore.freelancers.find(f => f.id === id || f.user_id === id);
  if (fl) {
    fl.verification_status = status;
    if (reason) fl.rejection_reason = reason;
    fl.updated_at = new Date().toISOString();
  }

  try {
    if (supabase) {
      await supabase
        .from('freelancer_profiles')
        .update({ verification_status: status, rejection_reason: reason, updated_at: new Date().toISOString() })
        .eq('id', id);
    }
  } catch (err) {
    console.warn('[Marketplace DB] Could not update verification status in Supabase:', err.message);
  }

  return fl || { id, verification_status: status };
}

export async function getPendingFreelancers() {
  try {
    if (supabase) {
      const { data, error } = await withTimeout(
        supabase
          .from('freelancer_profiles')
          .select('*')
          .eq('verification_status', 'pending_review')
      );

      if (!error && data) return data;
    }
  } catch (err) {
    console.warn('[Marketplace DB] Memory fallback for pending freelancers:', err.message);
  }
  return memoryStore.freelancers.filter(f => f.verification_status === 'pending_review');
}

// 4. Jobs & Projects Helpers

/**
 * Enrich a list of jobs with freelancer_user_id and freelancer_name by joining
 * against freelancer_profiles. This bridges the gap between jobs.freelancer_id
 * (profile UUID) and the auth user_id the freelancer actually signs in with.
 */
async function enrichJobsWithFreelancerInfo(jobs) {
  if (!supabase || !jobs || jobs.length === 0) return jobs;
  try {
    // Collect unique freelancer profile IDs
    const profileIds = [...new Set(jobs.map(j => j.freelancer_id).filter(Boolean))];
    if (profileIds.length === 0) return jobs;

    const { data: profiles } = await supabase
      .from('freelancer_profiles')
      .select('id, user_id, user_name, user_avatar')
      .in('id', profileIds);

    if (!profiles) return jobs;

    const profileMap = {};
    profiles.forEach(p => { profileMap[p.id] = p; });

    return jobs.map(j => {
      if (j.freelancer_id && profileMap[j.freelancer_id]) {
        const p = profileMap[j.freelancer_id];
        return {
          ...j,
          freelancer_user_id: p.user_id || j.freelancer_id,
          freelancer_name: j.freelancer_name || p.user_name || 'Freelancer',
          freelancer_avatar: j.freelancer_avatar || p.user_avatar || ''
        };
      }
      return j;
    });
  } catch (err) {
    console.warn('[Marketplace DB] Could not enrich jobs with freelancer info:', err.message);
    return jobs;
  }
}

export async function createJob(jobData) {
  const commissionRate = await getCommissionPercentage();
  const budget = Number(jobData.budget);
  const platformFee = (budget * commissionRate) / 100;
  const freelancerAmount = budget - platformFee;

  const jobPayload = {
    client_id: jobData.client_id,
    client_name: jobData.client_name || String(jobData.client_id || '').split('@')[0],
    client_email: jobData.client_email || '',
    freelancer_id: jobData.freelancer_id || null,
    title: jobData.title,
    description: jobData.description,
    category: jobData.category || 'General',
    budget,
    commission_percentage: commissionRate,
    platform_fee: platformFee,
    freelancer_amount: freelancerAmount,
    deadline_days: Number(jobData.deadline_days) || 7,
    // Direct hire = 'requested', open posting (no freelancer specified) = 'open'
    status: jobData.freelancer_id ? 'requested' : 'open',
    requirements: jobData.requirements || '',
    deliverable_notes: ''
  };

  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('jobs')
        .insert({ ...jobPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select()
        .single();
      if (!error && data) {
        memoryStore.jobs.push(data);
        return data;
      }
      if (error) console.warn('[Marketplace DB] Supabase job insert error:', error.message);
    }
  } catch (err) {
    console.warn('[Marketplace DB] Could not insert job to Supabase:', err.message);
  }

  // Memory fallback
  const fallbackJob = { id: `job_${Date.now()}`, ...jobPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  memoryStore.jobs.push(fallbackJob);
  return fallbackJob;
}

export async function getUserJobs(userId) {
  try {
    if (supabase) {
      // Resolve freelancer profile UUID for this user (may differ from user_id)
      let freelancerProfileId = null;
      try {
        const { data: flProfile } = await supabase
          .from('freelancer_profiles')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();
        if (flProfile) freelancerProfileId = flProfile.id;
      } catch (_) {}

      // Query jobs where user is client OR freelancer (by profile UUID)
      let query = supabase.from('jobs').select('*');
      if (freelancerProfileId) {
        query = query.or(`client_id.eq.${userId},freelancer_id.eq.${freelancerProfileId}`);
      } else {
        query = query.eq('client_id', userId);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (!error && data) {
        // Enrich jobs with freelancer_user_id (auth user_id) so messaging uses the correct ID
        return await enrichJobsWithFreelancerInfo(data);
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Memory fallback for user jobs:', err.message);
  }

  // Memory fallback — enrich from in-memory store
  const fl = memoryStore.freelancers.find(f => f.user_id === userId);
  const flId = fl ? fl.id : null;
  const jobs = memoryStore.jobs
    .filter(j => j.client_id === userId || (flId && j.freelancer_id === flId))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return jobs.map(j => {
    if (j.freelancer_id && !j.freelancer_user_id) {
      const fProfile = memoryStore.freelancers.find(f => f.id === j.freelancer_id);
      if (fProfile) {
        return { ...j, freelancer_user_id: fProfile.user_id || j.freelancer_id, freelancer_name: j.freelancer_name || fProfile.user_name };
      }
    }
    return j;
  });
}


/**
 * Get open job postings (no assigned freelancer) — for freelancers to browse.
 */
export async function getOpenJobs(filters = {}) {
  const { category, search } = filters;
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false });
      if (!error && data) {
        let results = data;
        if (category && category !== 'All') results = results.filter(j => j.category === category);
        if (search) {
          const s = search.toLowerCase();
          results = results.filter(j =>
            j.title?.toLowerCase().includes(s) ||
            j.description?.toLowerCase().includes(s) ||
            j.category?.toLowerCase().includes(s)
          );
        }
        return results;
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Memory fallback for open jobs:', err.message);
  }

  let results = memoryStore.jobs.filter(j => j.status === 'open');
  if (category && category !== 'All') results = results.filter(j => j.category === category);
  if (search) {
    const s = search.toLowerCase();
    results = results.filter(j => j.title?.toLowerCase().includes(s) || j.description?.toLowerCase().includes(s));
  }
  return results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getJobById(id) {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        const enriched = await enrichJobsWithFreelancerInfo([data]);
        return enriched[0] || data;
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Memory fallback for job lookup:', err.message);
  }
  return memoryStore.jobs.find(j => j.id === id) || null;

}

export async function updateJobStatus(id, status, deliverableNotes = '') {
  try {
    if (supabase) {
      const updates = { status, updated_at: new Date().toISOString() };
      if (deliverableNotes) updates.deliverable_notes = deliverableNotes;
      const { data, error } = await supabase.from('jobs').update(updates).eq('id', id).select().single();
      if (!error && data) {
        const idx = memoryStore.jobs.findIndex(j => j.id === id);
        if (idx >= 0) memoryStore.jobs[idx] = data;
        return data;
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Could not update job status in Supabase:', err.message);
  }

  const job = memoryStore.jobs.find(j => j.id === id);
  if (job) {
    job.status = status;
    if (deliverableNotes) job.deliverable_notes = deliverableNotes;
    job.updated_at = new Date().toISOString();
  }
  return job || { id, status };
}

/**
 * Assign a freelancer to an open job (when client accepts a proposal).
 */
export async function assignFreelancerToJob(jobId, freelancerProfileId) {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('jobs')
        .update({ freelancer_id: freelancerProfileId, status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .select()
        .single();
      if (!error && data) {
        const idx = memoryStore.jobs.findIndex(j => j.id === jobId);
        if (idx >= 0) memoryStore.jobs[idx] = data;
        return data;
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Could not assign freelancer to job:', err.message);
  }
  const job = memoryStore.jobs.find(j => j.id === jobId);
  if (job) { job.freelancer_id = freelancerProfileId; job.status = 'accepted'; job.updated_at = new Date().toISOString(); }
  return job;
}

// 5. Proposals Helpers

export async function createProposal({ jobId, freelancerUserId, freelancerProfileId, freelancerName, coverLetter, proposedRate }) {
  const proposal = {
    job_id: jobId,
    freelancer_user_id: freelancerUserId,
    freelancer_id: freelancerProfileId || null,
    freelancer_name: freelancerName || '',
    cover_letter: coverLetter || '',
    proposed_rate: Number(proposedRate) || 0,
    status: 'pending'
  };
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('proposals')
        .insert({ ...proposal, created_at: new Date().toISOString() })
        .select()
        .single();
      if (!error && data) { memoryStore.proposals.push(data); return data; }
      if (error) console.warn('[Marketplace DB] Supabase proposal insert error:', error.message);
    }
  } catch (err) {
    console.warn('[Marketplace DB] Could not insert proposal to Supabase:', err.message);
  }
  const fallback = { id: `prop_${Date.now()}`, ...proposal, created_at: new Date().toISOString() };
  memoryStore.proposals.push(fallback);
  return fallback;
}

export async function getProposalsForJob(jobId) {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('proposals')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      if (!error && data) return data;
    }
  } catch (err) {
    console.warn('[Marketplace DB] Memory fallback for proposals:', err.message);
  }
  return memoryStore.proposals.filter(p => p.job_id === jobId);
}

export async function acceptProposal(proposalId, jobId) {
  try {
    if (supabase) {
      const { data: proposal } = await supabase.from('proposals').select('*').eq('id', proposalId).maybeSingle();
      if (proposal) {
        await supabase.from('proposals').update({ status: 'accepted' }).eq('id', proposalId);
        await supabase.from('proposals').update({ status: 'rejected' }).eq('job_id', jobId).neq('id', proposalId);
        const updatedJob = await assignFreelancerToJob(jobId, proposal.freelancer_id);
        return { success: true, job: updatedJob, proposal };
      }
    }
  } catch (err) {
    console.warn('[Marketplace DB] Could not accept proposal in Supabase:', err.message);
  }
  const proposal = memoryStore.proposals.find(p => p.id === proposalId);
  if (proposal) {
    proposal.status = 'accepted';
    memoryStore.proposals.forEach(p => { if (p.job_id === jobId && p.id !== proposalId) p.status = 'rejected'; });
    const job = await assignFreelancerToJob(jobId, proposal.freelancer_id);
    return { success: true, job, proposal };
  }
  return { success: false };
}
