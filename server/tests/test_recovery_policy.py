import unittest
from server.recovery_policy import propose_recovery


class RecoveryPolicyTests(unittest.TestCase):
    def model(self,**reasoning):
        return {'supported_parameters':['max_tokens','reasoning'],
                'top_provider':{'max_completion_tokens':128000},
                'reasoning':{'mandatory':True,'supported_efforts':['low','medium','high','max'],**reasoning}}

    def test_exhausted_max_keeps_output_room_and_proposes_high_without_changing_the_original(self):
        request={'max_tokens':128000,'reasoning':{'effort':'max','summary':'auto'}}
        plan=propose_recovery(request,{'finish_reason':'length'},self.model())
        self.assertEqual(plan['parameters'],{'max_tokens':128000,'reasoning':{'effort':'high','summary':'auto'}})
        self.assertEqual(request['reasoning']['effort'],'max')

    def test_another_exhaustion_steps_down_only_to_an_effort_supported_by_that_model(self):
        request={'max_tokens':128000,'reasoning':{'effort':'high'}}
        self.assertEqual(propose_recovery(request,{'finish_reason':'length'},self.model())['parameters']['reasoning']['effort'],'medium')
        self.assertFalse(propose_recovery({**request,'reasoning':{'effort':'low'}},{'finish_reason':'length'},self.model())['available'])

    def test_cancelled_or_successful_calls_do_not_get_silently_downgraded(self):
        for reason in (None,'stop','content_filter'):
            self.assertIsNone(propose_recovery({'max_tokens':128000,'reasoning':{'effort':'max'}},{'finish_reason':reason},self.model()))

    def test_fixed_thinking_budget_is_reduced_without_mixing_it_with_effort(self):
        request={'max_completion_tokens':32000,'reasoning':{'max_tokens':20000}}
        model={'supported_parameters':['max_completion_tokens','reasoning'],
               'top_provider':{'max_completion_tokens':32000},'reasoning':{'supports_max_tokens':True}}
        params=propose_recovery(request,{'finish_reason':'length'},model)['parameters']
        self.assertEqual(params,{'max_completion_tokens':32000,'reasoning':{'max_tokens':4096}})

    def test_missing_capabilities_never_turn_into_an_invented_setting(self):
        plan=propose_recovery({'max_tokens':128000,'reasoning':{'effort':'max'}},{'finish_reason':'length'}, {})
        self.assertFalse(plan['available'])
