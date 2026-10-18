"""Narrow app-to-selector mapping. No clock/field-name guessing in the selector.

originalRace.facts contains explicitly established original-race facts. The
collector's observations and raced_at are retained for investigation only.
Trusted sidecars use the same schema and must bind the selected canonical hash.
"""
from datetime import timedelta
import hashlib
from globalsim_bridge.versioning import canonical, select_compatibility, EVIDENCE_FIELDS, _time


def capture_hash(capture):
    return hashlib.sha256(canonical(capture)).hexdigest()


def map_evidence(capture, registry, sidecar=None):
    digest = capture_hash(capture)
    unknown = {'schemaVersion': 1, 'captureSha256': digest, 'provenance': {}}
    notes = []
    original = capture.get('originalRace', capture.get('original_race', {}))
    try:
        if 'originalRace' in capture and 'original_race' in capture and capture['originalRace'] != capture['original_race']:
            raise ValueError('Conflicting original-race provenance objects.')
        if not isinstance(original, dict) or original.get('schemaVersion', 1) != 1:
            raise ValueError('Original-race provenance has an unsupported schema.')
        if sidecar is not None:
            if not isinstance(sidecar, dict) or sidecar.get('schemaVersion', 1) != 1 or sidecar.get('captureSha256') != digest:
                raise ValueError('Original-race sidecar belongs to a different capture.')
            stored, added = original.get('facts', {}), sidecar.get('facts', {})
            if not isinstance(stored, dict) or not isinstance(added, dict):
                raise ValueError('Original-race facts must be objects.')
            for field in stored.keys() & added.keys():
                left, right = stored[field]['value'], added[field]['value']
                if field == 'occurredAt':
                    left, right = _time(left, field), _time(right, field)
                if left != right:
                    raise ValueError('Original-race sidecar conflicts with captured original facts.')
            combined = {**stored, **added}
            if 'occurredAt' in stored and 'occurredAt' in added:
                combined['occurredAt'] = {**added['occurredAt'], 'precisionMicros': max(
                    stored['occurredAt'].get('precisionMicros', 0), added['occurredAt'].get('precisionMicros', 0))}
            original = dict(sidecar, facts=combined)
        facts = original.get('facts', {})
        if not isinstance(facts, dict) or set(facts) - EVIDENCE_FIELDS:
            raise ValueError('Unknown original-race fact fields.')
        evidence = dict(unknown, provenance={})
        for field, fact in facts.items():
            if not isinstance(fact, dict) or not {'value', 'source', 'reference'} <= fact.keys():
                raise ValueError('Each original-race fact needs its value and concrete provenance.')
            evidence[field] = fact['value']
            evidence['provenance'][field] = {key: fact[key] for key in ('source', 'reference')}
        if 'occurredAt' in evidence:
            fact = facts['occurredAt']
            moment = _time(evidence['occurredAt'], 'originalRace.facts.occurredAt')
            evidence['occurredAt'] = moment.isoformat().replace('+00:00', 'Z')
            # Precision is an interval [timestamp,timestamp+precision). A
            # timestamp alone is not assumed infinitely precise. Exact rules
            # must agree throughout the interval too.
            precision = fact.get('precisionMicros')
            if type(precision) is not int or not 1 <= precision <= 86400000000:
                raise ValueError('Original occurrence requires explicit precisionMicros (1..one day).')
            end = moment + timedelta(microseconds=precision)
            probes = [moment, end - timedelta(microseconds=1)]
            for row in [*registry.get('eras', []), *registry.get('futureInferencePolicies', [])]:
                for stamp in row.get('window', {}).values():
                    boundary = _time(stamp, 'registry boundary')
                    if moment < boundary < end:
                        probes.extend([boundary, boundary - timedelta(microseconds=1)])
            selections = []
            for probe in probes:
                decision = select_compatibility(digest, dict(evidence, occurredAt=probe.isoformat()), registry)
                selections.append(canonical({k: decision[k] for k in
                    ('mode', 'evidenceStatus', 'matchedEraId', 'simulation', 'inference', 'provisionalPolicy')}))
            if len(set(selections)) != 1:
                raise ValueError('Original occurrence precision crosses a support boundary; no unique version can be assigned.')
        if not facts:
            notes.append('The logged racedAt is a display clock. Its occurrence semantics/offset and original region/version are not established.')
        return evidence, notes
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        # Retain the invalid marker: do not permit an exact rule to override an
        # ambiguous/conflicting supplied time by silently deleting that time.
        return {**unknown, 'invalidApplicationEvidence': True}, [str(error)]
