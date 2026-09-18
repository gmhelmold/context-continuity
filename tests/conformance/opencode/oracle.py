"""Independent test oracles. Never import the JavaScript renderer."""
from copy import deepcopy

def content_text(value):
    if value is None: return ''
    if isinstance(value, str): return value
    assert isinstance(value, list) and all(p.get('type') == 'text' for p in value), 'E_ORACLE_CONTENT'
    return '\n'.join(p['text'] for p in value)

def protocol(messages):
    pending=[]; seen=set()
    for message in messages:
        if message['role']=='tool':
            assert pending and message.get('tool_call_id')==pending.pop(0), 'E_ORACLE_TOOL_ID_ORDER'
        else:
            assert not pending, 'E_ORACLE_MISSING_TOOL'
            calls=message.get('tool_calls',[])
            for call in calls:
                assert call['id'] not in seen, 'E_ORACLE_DUPLICATE_CALL'
                seen.add(call['id']);pending.append(call['id'])
    assert not pending, 'E_ORACLE_MISSING_TOOL'

def exact_retained(ingress, observed, marker, summary):
    """The fixture contracts permit replacing ONLY closed history before marker.
    Ingress is pre-transform evidence, observed is an independent network recorder.
    All untouched fields (including unknown metadata) must compare exactly.
    """
    raw=ingress['messages']
    cut=next(i for i,m in enumerate(raw) if m['role']=='user' and content_text(m.get('content'))==marker)
    protected=0
    while protected<len(raw) and raw[protected]['role'] in ('system','developer'):protected+=1
    expected=deepcopy(ingress)
    expected['messages']=deepcopy(raw[:protected])+[{'role':'assistant','content':summary}]+deepcopy(raw[cut:])
    assert observed==expected, 'E_ORACLE_RETAINED_PAYLOAD'
    protocol(observed['messages'])

def native_tools(history, wire):
    """Expected outputs are built from PUBLIC source records and a specified
    tool contract. Same count/content is not allowed to replace call identity.
    """
    expected={}
    for message in history:
        for part in message['parts']:
            if part['type']=='tool' and part['state']['status']=='completed':
                expected[part['callID']]=part['state']['output']
                if part['tool']=='cc_probe':
                    text='CC_TOOL_RESULT::'+message['info']['sessionID']+'::'+message['info']['id']+':local-test-only'
                    assert part['state']['output']==text, 'E_ORACLE_TOOL_IMPLEMENTATION'
    for message in wire:
        if message['role']=='tool':
            assert message['tool_call_id'] in expected, 'E_ORACLE_UNKNOWN_RESULT'
            assert content_text(message.get('content'))==expected[message['tool_call_id']], 'E_ORACLE_TOOL_CONTENT'
    protocol(wire)
