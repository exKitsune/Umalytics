"""Explicit engine identities; historical bundles retain their original pins."""

CURRENT_PROFILE = 'v77'
PROFILE_COMMITS = {
    'v74': 'efc2decdfeaff227ada0e9847f5deceb42c3b97f',
    'v77': '95f1416fb8c130dd2ef4b53c3b8277c6ba4c8055',
}


def upstream_commit(profile):
    try:
        return PROFILE_COMMITS[profile]
    except (KeyError, TypeError):
        raise ValueError('Unsupported GlobalSim profile') from None
