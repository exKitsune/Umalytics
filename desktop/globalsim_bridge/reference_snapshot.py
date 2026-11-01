"""Read-only cached JSON trees; prepared requests still receive mutable copies."""
from copy import deepcopy


def _readonly(*_args, **_kwargs):
    raise TypeError('Reference snapshots are read-only')


class _Object(dict):
    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = __ior__ = _readonly

    def __deepcopy__(self, memo):
        result = {}
        memo[id(self)] = result
        result.update((key, deepcopy(value, memo)) for key, value in self.items())
        return result


class _Array(list):
    __setitem__ = __delitem__ = append = clear = extend = insert = pop = remove = reverse = sort = __iadd__ = __imul__ = _readonly

    def __deepcopy__(self, memo):
        result = []
        memo[id(self)] = result
        result.extend(deepcopy(value, memo) for value in self)
        return result


def freeze(value):
    if isinstance(value, dict):
        return _Object((key, freeze(item)) for key, item in value.items())
    if isinstance(value, list):
        return _Array(freeze(item) for item in value)
    return value
